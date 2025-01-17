import multer from "multer";
import express from "express";
import { createData } from "./feat.js";
export const upload = multer().array("file", 2);
const app = express();
app.use(express.json());
app.listen(5000, () => {
    console.log("app is listening");
});
app.post("/create", upload, createData);
