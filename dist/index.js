import express from "express";
import { createData, deleteData, readData, updateData } from "./feat.js";
import upload from "./multers3.js";
import { connectDB } from "./connectDB.js";
const app = express();
connectDB();
app.use(express.json());
app.listen(5000, () => {
    console.log("app is listening");
});
app.post("/create", upload.array("file"), createData);
app.post("/update/:id", upload.array("file"), updateData);
app.get("/", readData);
app.delete("/deleteProduct/:id", deleteData);
