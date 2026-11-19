require("dotenv").config({ quiet: true });
const jwt = require("jsonwebtoken");

const [email, name] = process.argv.slice(2);
if (!email) {
  console.error("Usage: node gen-token.js <email> <name>");
  process.exit(1);
}

console.log(jwt.sign({ email, name: name || "" }, process.env.JWT_SECRET, { expiresIn: "7d" }));