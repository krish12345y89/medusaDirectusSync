import { config } from "dotenv";
import mongoose from "mongoose";
config();
const URI = process.env.MONGO_URi || "mongodb://localhost:27017/db";
export const connectDB = async () => {
    console.log(URI);
    await mongoose
        .connect(URI)
        .then(() => {
        console.log("Backend application is connected to the database");
    })
        .catch((err) => {
        console.log(err);
    });
};
