const QrCode = require('qrcode');
export async function generateOrderQRCode(orderReference: string) {
  const orderTrackingURL = `https://qoobea.com/track-order/${orderReference}`;
  try {
    const qrCodeURL = await QrCode.toDataURL(orderTrackingURL);
    return qrCodeURL;
  } catch (err) {
    console.error('Error generating QR code', err);
    return null;
  }
}
