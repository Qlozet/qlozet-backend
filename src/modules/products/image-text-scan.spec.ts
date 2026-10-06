import { findContactDetail } from './listing-rules';

/**
 * The image side of the contact-detail rule.
 *
 * Both the typed description and the text inside a photo go through one
 * detector, so these cases are about the shapes OCR produces rather than the
 * shapes a person types: all-caps, line breaks between every element, and the
 * spacing that comes from reading characters off a picture.
 *
 * The cases that must NOT fire matter most. Refusing a photo is refusing a
 * vendor's work, and a size chart printed on a lookbook image is full of
 * exactly the digits a phone-number pattern is hunting for.
 */
describe('contact details inside product photos', () => {
  describe('catches what a vendor would actually print on an image', () => {
    it.each([
      ['a number on a lookbook slide', 'KEMI COUTURE\n0803 123 4567'],
      ['a number with no spacing', 'ORDER NOW 08031234567'],
      ['an international number', 'CALL +234 803 123 4567'],
      ['a watermarked handle', '@kemi_couture'],
      ['an instagram callout', 'FOLLOW US ON INSTAGRAM'],
      ['a whatsapp badge', 'WHATSAPP ONLY'],
      ['an email on a contact card', 'orders@kemicouture.com'],
    ])('%s', (_label, ocrText) => {
      expect(findContactDetail(ocrText)).not.toBeNull();
    });
  });

  describe('leaves legitimate photo text alone', () => {
    it.each([
      ['a size chart', 'SIZE CHART\nS 36\nM 38\nL 40\nXL 42'],
      ['measurements in inches', 'CHEST 38 - 40\nSLEEVE 24\nLENGTH 32'],
      ['a care label', '100% COTTON\nMACHINE WASH 30\nDO NOT BLEACH'],
      ['a brand name alone', 'KEMI COUTURE\nLAGOS'],
      ['a price tag', 'N15,000\nSALE'],
      ['a year on a lookbook', 'AUTUMN 2024 COLLECTION'],
      ['a style code', 'STYLE 2024 / REF 8891'],
    ])('%s', (_label, ocrText) => {
      expect(findContactDetail(ocrText)).toBeNull();
    });
  });

  describe('the absent case', () => {
    it('treats no detected text as nothing to object to', () => {
      // OCR off, or a photo with no writing on it. Either way the upload
      // proceeds: silence is not a violation.
      expect(findContactDetail('')).toBeNull();
    });
  });
});
