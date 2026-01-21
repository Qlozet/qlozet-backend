require('dotenv').config();
const zohoConfig = {
  clientID: process.env.ZOHO_CLIENT_ID || '',
  clientSecret: process.env.ZOHO_CLIENT_SECRET || '',
  baseUrl: process.env.ZOHO_BASE_URL,
  scope: process.env.ZOHO_SCOPE,
  tickets: 'https://desk.zoho.com/api/v1/tickets',
};

export default zohoConfig;
