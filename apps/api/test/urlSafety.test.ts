import { describe, expect, it } from 'vitest';
import { assertSafeUrl, UnsafeUrlError } from '../src/services/urlSafety.js';

describe('assertSafeUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('ftp://example.com/x')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects loopback addresses', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://localhost/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://[::1]/')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects the cloud metadata / link-local range', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects RFC1918 private ranges', async () => {
    await expect(assertSafeUrl('http://10.0.0.5/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://172.16.0.1/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://192.168.1.1/')).rejects.toThrow(UnsafeUrlError);
  });

  it('allows a normal public https URL', async () => {
    await expect(assertSafeUrl('https://93.184.216.34/')).resolves.toBeInstanceOf(URL);
  });

  it('rejects an unresolvable hostname', async () => {
    await expect(
      assertSafeUrl('http://this-host-should-never-resolve.invalid/'),
    ).rejects.toThrow(UnsafeUrlError);
  });
});
