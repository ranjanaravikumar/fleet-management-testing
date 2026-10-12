// Copies the frontend mock data into a JSON file the backend loads on reset.
// Run from the project root after changing src/data/mockData.js:
//   node scripts/export-mock-data.mjs
import { writeFileSync } from 'node:fs';
import { DRIVERS, INITIAL_LOADS, USER_SHIPMENTS, COMPANIES } from '../src/data/mockData.js';

const data = { DRIVERS, INITIAL_LOADS, USER_SHIPMENTS, COMPANIES };
writeFileSync('backend/tms/fixtures/mock_data.json', JSON.stringify(data, null, 2));
console.log('Wrote backend/tms/fixtures/mock_data.json');
