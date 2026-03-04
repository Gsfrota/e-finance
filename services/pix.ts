
/**
 * Utility class to generate Pix Payload (BR Code)
 * Standard: EMVCo
 */

export class PixPayload {
  private pixKey: string;
  private merchantName: string;
  private merchantCity: string;
  private amount: string;
  private txId: string;

  constructor(key: string, name: string, city: string, amount: number, txId: string = '***') {
    this.pixKey = key;
    this.merchantName = this.normalize(name, 25);
    this.merchantCity = this.normalize(city, 15);
    this.amount = amount.toFixed(2);
    this.txId = txId;
  }

  private normalize(str: string, limit: number): string {
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .substring(0, limit)
      .toUpperCase();
  }

  private formatField(id: string, value: string): string {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
  }

  private getMerchantAccountInfo(): string {
    const gui = this.formatField('00', 'BR.GOV.BCB.PIX');
    const key = this.formatField('01', this.pixKey);
    return this.formatField('26', `${gui}${key}`);
  }

  private getCRC16(payload: string): string {
    let crc = 0xFFFF;
    const polynomial = 0x1021;

    for (let i = 0; i < payload.length; i++) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
          crc = (crc << 1) ^ polynomial;
        } else {
          crc = crc << 1;
        }
      }
    }
    
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  }

  public generate(): string {
    const payload = [
      this.formatField('00', '01'), // Payload Format Indicator
      this.getMerchantAccountInfo(), // Merchant Account Information
      this.formatField('52', '0000'), // Merchant Category Code
      this.formatField('53', '986'), // Transaction Currency (BRL)
      this.formatField('54', this.amount), // Transaction Amount
      this.formatField('58', 'BR'), // Country Code
      this.formatField('59', this.merchantName), // Merchant Name
      this.formatField('60', this.merchantCity), // Merchant City
      this.formatField('62', this.formatField('05', this.txId)), // Additional Data Field Template (TxID)
      '6304' // CRC16 ID + Length
    ].join('');

    const crc = this.getCRC16(payload);
    return `${payload}${crc}`;
  }
}

export const generatePixString = (
    key: string, 
    name: string, 
    city: string, 
    amount: number, 
    identifier: string = '***'
): string => {
    try {
        const pix = new PixPayload(key, name, city, amount, identifier);
        return pix.generate();
    } catch (e) {
        console.error("Error generating Pix:", e);
        return "";
    }
};
