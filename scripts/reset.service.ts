import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
dotenv.config();

async function dropDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to database');

    await mongoose.connection.dropDatabase();
    console.log('Database dropped successfully!');

    await mongoose.disconnect();
    console.log('Disconnected from database.');
  } catch (err) {
    console.error('Error dropping database:', err);
  }
}

dropDatabase();
