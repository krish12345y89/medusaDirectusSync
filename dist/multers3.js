import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
dotenv.config();
const accessKey = process.env.AWS_ACCESS_KEY;
const secretKey = process.env.AWS_SECRET_KEY;
const region = process.env.AWS_REGION;
const bucket = process.env.AWS_S3_BUCKET;
dotenv.config();
const s3Client = new S3Client({
    region: region,
    credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
    },
});
// Set up multer with multer-s3 for file uploads to S3
const s3Storage = multerS3({
    s3: s3Client, //  S3Client instance
    bucket: bucket, //  S3 bucket name
    metadata: (req, file, cb) => {
        cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
        // Generate a unique file name for each upload
        const fileName = `${Date.now()}-${file.originalname}`;
        cb(null, fileName); // The file will be stored with this name in S3
    },
});
// Configure the multer middleware with the S3 storage
export const upload = multer({
    storage: s3Storage,
    limits: {
        fileSize: 1 * 1024 * 1024, // Limit file size to 1MB (optional)
    },
});
// Export the configured multer instance for use in routes
export default upload;
