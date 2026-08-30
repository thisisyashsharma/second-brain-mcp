const fs = require('fs');
const data = JSON.parse(fs.readFileSync('output/Zomato_Annual_Report_2023-24_structured.json', 'utf8'));
console.log(Object.keys(data));
if (data.type) console.log(data.type);
console.log(Array.isArray(data));
