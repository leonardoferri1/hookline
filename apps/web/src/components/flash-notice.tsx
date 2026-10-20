import { peekFlash } from '@/lib/flash';
import { FlashCleanup } from './flash-cleanup';

/**
 * Renders the one-shot message. A revealed secret is printed in full, with the reminder that it
 * will not be shown again, because that is the only moment the operator can copy it.
 */
export async function FlashNotice() {
  const flash = await peekFlash();
  if (!flash) return null;

  const body =
    flash.tone === 'secret' && flash.reveal ? (
      <div className="notice success" role="status">
        <strong>{flash.message}</strong>
        <p className="secret" style={{ marginTop: 10, marginBottom: 0 }}>
          {flash.reveal}
        </p>
      </div>
    ) : (
      <div
        className={`notice ${flash.tone === 'error' ? 'error' : 'success'}`}
        role={flash.tone === 'error' ? 'alert' : 'status'}
      >
        {flash.message}
      </div>
    );

  return (
    <>
      {body}
      <FlashCleanup />
    </>
  );
}
