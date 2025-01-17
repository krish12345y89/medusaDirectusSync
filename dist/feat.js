import { createDirectus, rest, staticToken, createItem, updateItem, readItems, deleteItem, } from "@directus/sdk";
import axios from "axios";
import { v4 as uuid4 } from "uuid";
import { sync } from "./models/sync.js";
const DIRECTUS_URL = "http://127.0.0.1:8055";
const DIRECTUS_API_TOKEN = "FW3lp6CmNk4XG4lGmTnPdEBvPbnDK6-h";
const MEDUSA_URL = "http://127.0.0.1:9000";
const MEDUSA_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY3Rvcl9pZCI6InVzZXJfMDFKSEc5R0RSOEExNE1NN1Y2WlFCNTBZOFQiLCJhY3Rvcl90eXBlIjoidXNlciIsImF1dGhfaWRlbnRpdHlfaWQiOiJhdXRoaWRfMDFKSEc5R0RQQ1kxQllIMTk3QUExNlhFQTYiLCJhcHBfbWV0YWRhdGEiOnsidXNlcl9pZCI6InVzZXJfMDFKSEc5R0RSOEExNE1NN1Y2WlFCNTBZOFQifSwiaWF0IjoxNzM3MDIwNzY0LCJleHAiOjE3MzcxMDcxNjR9.uyciCm3PTTdeYR7ms15pUN0CTt9QbWyjBORATWfReNI";
const directus = createDirectus(DIRECTUS_URL)
    .with(staticToken(DIRECTUS_API_TOKEN))
    .with(rest());
const axiosInstance = axios.create({
    baseURL: MEDUSA_URL + "/admin",
    headers: {
        Authorization: `Bearer ${MEDUSA_API_TOKEN}`,
    },
});
// Helper function to sync product to Medusa
const syncNewProduct = async (product, update) => {
    try {
        const generateHandle = (name) => {
            return name
                .toLowerCase() // Convert to lowercase
                .replace(/[^a-z0-9\s]/g, "") // Remove non-alphanumeric characters
                .trim() // Remove leading/trailing spaces
                .replace(/\s+/g, "-"); // Replace spaces with hyphens
        };
        const formatProductData = {
            title: product.name,
            status: "draft",
            description: product.description || "No description provided",
            handle: await generateHandle(product.name),
            thumbnail: product.images && product.images.length > 0
                ? product.images[0].url
                : "", // Use existing images for thumbnail
            images: product.images && product.images.length > 0
                ? product.images.map((image) => ({ url: image.url, id: uuid4() }))
                : undefined, // Pass undefined to keep existing images in Medusa
            variants: [
                {
                    title: "Default Variant",
                    prices: [
                        {
                            amount: Number(product.price) || 0,
                            currency_code: "usd",
                        },
                    ],
                },
            ],
            options: [
                {
                    title: "Color",
                    values: product.colors || [],
                },
                {
                    title: "Storage",
                    values: product.storageOptions || [],
                },
            ],
        };
        let response;
        if (update) {
            // Ensure existing data is merged properly
            response = await axiosInstance.post(`/products/${update}`, formatProductData);
        }
        else {
            response = await axiosInstance.post("/products", formatProductData);
        }
        return response.data;
    }
    catch (error) {
        console.error("Error syncing new product to Medusa:", error.response?.data || error.message);
        throw new Error("Failed to sync product to Medusa");
    }
};
// Create new product
export const createData = async (req, res, next) => {
    try {
        const data = req.body; // Extract product data from the request body
        const files = req.files;
        // Check if product already exists
        const resu = await sync.findOne({ directusNmae: data.name });
        if (resu) {
            throw new Error("Product already exists");
        }
        // Extract file locations (filenames or paths)
        let fileLocations = [];
        if (files) {
            files.forEach((file) => {
                fileLocations.push({ url: file.location });
            });
        }
        console.log(fileLocations);
        // Create the product in Directus
        console.log(data);
        if (data) {
            const newData = {
                ...data,
                images: fileLocations,
            };
            const result = await directus.request(createItem("product", newData));
            // Sync the new product with Medusa
            const medusaResult = await syncNewProduct(newData);
            // Create sync record in the database
            const dt = await sync.create({
                medusaid: medusaResult.product.id,
                directusId: result.id,
                directusNmae: newData.name,
                description: newData.description,
                images: newData.images,
            });
            res.status(201).json({
                result,
                medusaResult,
            });
        }
    }
    catch (error) {
        console.error("Error creating product:", error);
        res.status(500).send("Failed to create product");
    }
};
// Update product data
export const updateData = async (req, res, next) => {
    try {
        const data = req.body;
        const files = req.files;
        const id = req.params.id;
        // Fetch existing product data from sync collection
        const ress = await sync.findOne({ directusId: id });
        if (!ress) {
            throw new Error("Item does not exist. Please create it first.");
        }
        // Use previous values if not provided
        data.name = data.name || ress.directusNmae;
        data.description = data.description || ress.description;
        // Handle image file locations
        let fileLocations = [];
        if (files) {
            files.forEach((file) => {
                fileLocations.push({ url: file.location });
            });
        }
        const newData = {
            ...data,
            images: files ? fileLocations : ress.images,
        };
        const result = await directus.request(updateItem("product", id, data));
        // Sync the updated product with Medusa
        const updatedMedusaData = await syncNewProduct(newData, ress.medusaid);
        const updatedSync = await sync.updateOne({ directusId: id }, {
            directusNmae: newData.name,
            description: newData.description,
            images: files ? fileLocations : ress.images,
            medusaid: updatedMedusaData.product.id,
        });
        res.status(200).json({
            result,
            updatedMedusaData,
            updatedSync,
        });
    }
    catch (error) {
        console.error("Error updating product:", error);
        res.status(500).send("Failed to update product");
    }
};
export const readData = async (req, res) => {
    try {
        const directusData = await directus.request(readItems("product"));
        const medusaData = (await axiosInstance.get("/products")).data.products;
        if (!directusData && !medusaData) {
            res.send("no item found , please create it");
        }
        res.json({
            directusData,
            medusaData,
        });
    }
    catch (error) {
        console.error("Error updating product:", error);
        res.status(500).send("Failed to read products");
    }
};
// Delete product
export const deleteData = async (req, res) => {
    try {
        const id = req.params.id;
        // Fetch the product from the sync collection
        const ress = await sync.findOne({ directusId: id });
        if (!ress) {
            throw new Error("Product not found. Nothing to delete.");
        }
        // Delete the product from Directus
        await directus.request(deleteItem("product", id));
        // Delete the product from Medusa
        await axiosInstance.delete(`/products/${ress.medusaid}`);
        // Delete the product from the sync collection
        await sync.deleteOne({ directusId: id });
        res.status(200).send("Product deleted successfully from all systems.");
    }
    catch (error) {
        console.error("Error deleting product:", error.message || error);
        res.status(500).send("Failed to delete product.");
    }
};
