require("dotenv").config();
const db = require("./config/db");
const http = require("http");
const express = require("express");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const swaggerDocs = require("./routes/utils/swagger");
const firebaseApp = require("./config/firebase");
const stripeWebhook  = require('./controllers/stripe/stripe.webhook')


app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhook
);
app.use(morgan("dev"));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
firebaseApp();

// route
require("./routes/api/index.routes")(app);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack); // Log the error for debugging
  res.status(500).json({
    code: 500,
    message: "Internal server error",
    success: false,
    error: err.message || "Something went wrong"
  });
});

// Catch unhandled exceptions and promise rejections
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

const server = http.Server(app);
const port = process.env.PORT || 3000;

db.then((response) => {
  console.log(`Database Connected: ${response}`);
  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
    swaggerDocs(app);
  });
}).catch((err) => console.log(`Database ${err}`));
