const bwipjs = require('bwip-js');

/**
 * Sinh hình ảnh tem mã vạch Code 128 dạng PNG (Base64) từ mã lô.
 * Nội dung mã vạch CHỈ chứa duy nhất Mã Lô (e.g. LO20260904001)
 * @param {string} text Mã lô cần mã hóa
 */
async function generateCode128Base64(text) {
  try {
    const pngBuffer = await bwipjs.toBuffer({
      bcid: 'code128',       // Barcode type Code 128
      text: text,            // Text to encode (Batch code)
      scale: 3,              // 3x scaling
      height: 12,            // Bar height, in millimeters
      includetext: true,     // Include human-readable text
      textxalign: 'center',  // Centered text
      textcolor: '000000',   // Black text
    });
    
    return 'data:image/png;base64,' + pngBuffer.toString('base64');
  } catch (err) {
    console.error('[Barcode Gen Error]:', err);
    throw err;
  }
}

module.exports = {
  generateCode128Base64
};
