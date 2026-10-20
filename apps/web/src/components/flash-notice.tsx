import { takeFlash } from '@/lib/flash';

/**
 * Renders and consumes the one-shot message. A revealed secret is printed in full, with the
 * reminder that it will not be shown again, because that is the only moment the operator can copy
 * it.
 */
export async function FlashNotice() {
  const flash = await takeFlash();
  if (!flash) return null;

  if (flash.tone === 'secret' && flash.reveal)
    return (
      <div className="notice success" role="status">
        <strong>{flash.message}</strong>
        <p className="secret" style={{ marginTop: 10, marginBottom: 0 }}>
          {flash.reveal}
        </p>
      </div>
    );

  return (
    <div
      className={`notice ${flash.tone === 'error' ? 'error' : 'success'}`}
      role={flash.tone === 'error' ? 'alert' : 'status'}
    >
      {flash.message}
    </div>
  );
}
