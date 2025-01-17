import { createDirectus, rest, staticToken, createItem, updateItem, deleteItem } from "@directus/sdk";
import axios from "axios";
import mongoose from "mongoose";
import { connectDB } from "./connectDB.js";
// Define schema for syncing data between Directus and Medusa
const schema = new mongoose.Schema({
    medusaId: String,
    medusaName: String,
    directusId: String,
    directusName: String,
    images: Array,
    description: String,
}, { timestamps: true });
export const SyncModel = mongoose.model("Sync", schema);
// Configure Directus SDK and Axios for Medusa
const DIRECTUS_URL = "http://127.0.0.1:8055";
const DIRECTUS_API_TOKEN = "4areaTkf4uafC_Gz10SvOt_FLPc-Ugkj";
const MEDUSA_URL = "http://127.0.0.1:9000/admin";
const MEDUSA_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY3Rvcl9pZCI6InVzZXJfMDFKSFQyOUYxQzFQV0dRWVhSMkY1MDk5TVoiLCJhY3Rvcl90eXBlIjoidXNlciIsImF1dGhfaWRlbnRpdHlfaWQiOiJhdXRoaWRfMDFKSFQyOUVYQ0M5RkoySktaUk5FMzMzSlEiLCJhcHBfbWV0YWRhdGEiOnsidXNlcl9pZCI6InVzZXJfMDFKSFQyOUYxQzFQV0dRWVhSMkY1MDk5TVoifSwiaWF0IjoxNzM3MTE1ODEzLCJleHAiOjE3MzcyMDIyMTN9.WRa-nLvmJmYEvEAf1S9s41hv-_8lK8EzEFaegWP7i8A";
// Initialize Directus SDK and Axios for Medusa
const directus = createDirectus(DIRECTUS_URL)
    .with(staticToken(DIRECTUS_API_TOKEN))
    .with(rest());
const axiosInstance = axios.create({
    baseURL: MEDUSA_URL,
    headers: { Authorization: `Bearer ${MEDUSA_API_TOKEN}` },
});
// Helper function to log API responses and validate them
const validateApiResponse = (response, endpoint) => {
    console.log(`Response from ${endpoint}:`, response);
    if (!response || typeof response !== "object" || !response.data) {
        console.error(`Invalid response from ${endpoint}:`, response);
        throw new Error(`Invalid response structure from ${endpoint}`);
    }
    return response.data;
};
// Helper function to generate a handle for the product name
const generateHandle = (name) => {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "-");
};
// Sync product creation from Medusa to Directus
const syncMedusaToDirectus = async (medusaProduct) => {
    try {
        console.log("Syncing Medusa product to Directus:", medusaProduct);
        const directusData = {
            name: medusaProduct.title,
            description: medusaProduct.description || "No description available",
            images: medusaProduct.images && medusaProduct.images.length > 0
                ? medusaProduct.images.map((image) => ({ url: image.url }))
                : undefined,
            price: medusaProduct.variants[0]?.prices[0]?.amount || 0, // Handle missing fields
        };
        console.log("Directus data to be created:", directusData);
        const createdDirectusProduct = await directus.request(createItem("product", directusData));
        console.log("Directus product created successfully:", createdDirectusProduct);
        await SyncModel.create({
            medusaId: medusaProduct.id,
            medusaName: medusaProduct.title,
            directusId: createdDirectusProduct.id,
            directusName: createdDirectusProduct.name,
            description: createdDirectusProduct.description,
            images: createdDirectusProduct.images,
        });
        console.log("Product relationship saved to MongoDB");
    }
    catch (error) {
        console.error("Error syncing Medusa product to Directus:", error.message);
        throw error;
    }
};
// Sync updated product data
const syncMedusaUpdateToDirectus = async (medusaProduct) => {
    try {
        console.log("Updating Medusa product in Directus:", medusaProduct);
        const existingSync = await SyncModel.findOne({ medusaId: medusaProduct.id });
        if (!existingSync) {
            console.log("Product not synced previously. Skipping update.");
            return;
        }
        const updatedDirectusData = {
            name: medusaProduct.title,
            description: medusaProduct.description || "No description available",
            images: medusaProduct.images.url || [],
            price: medusaProduct.variants[0]?.prices[0]?.amount || 0,
        };
        console.log("Directus data to be updated:", updatedDirectusData);
        const updatedDirectusProduct = await directus.request(updateItem("product", existingSync.directusId, updatedDirectusData));
        console.log("Directus product updated successfully:", updatedDirectusProduct);
        await SyncModel.updateOne({ medusaId: medusaProduct.id }, {
            directusName: updatedDirectusProduct.name,
            description: updatedDirectusProduct.description,
            images: updatedDirectusProduct.images,
        });
        console.log("Product relationship updated in MongoDB");
    }
    catch (error) {
        console.error("Error updating Medusa product in Directus:", error.message);
        throw error;
    }
};
// Sync product deletion
const syncMedusaDeleteToDirectus = async (medusaProductId) => {
    try {
        console.log(`Deleting Medusa product (ID: ${medusaProductId}) from Directus`);
        const existingSync = await SyncModel.findOne({ medusaId: medusaProductId });
        if (!existingSync) {
            console.log("Product not synced. Nothing to delete.");
            return;
        }
        await directus.request(deleteItem("product", existingSync.directusId));
        console.log("Directus product deleted successfully");
        await SyncModel.deleteOne({ medusaId: medusaProductId });
        console.log("Product relationship deleted from MongoDB");
    }
    catch (error) {
        console.error("Error deleting product from Directus:", error.message);
        throw error;
    }
};
// Main bidirectional sync function
const bidirectionalSync = async () => {
    try {
        console.log("Fetching Medusa products...");
        const medusaProductsResponse = await axiosInstance.get("/products");
        const medusaProducts = validateApiResponse(medusaProductsResponse, "/products").products;
        // Sync products from Medusa to Directus (new or updated)
        for (const product of medusaProducts) {
            const existingSync = await SyncModel.findOne({ medusaId: product.id });
            if (!existingSync) {
                await syncMedusaToDirectus(product);
            }
            else {
                await syncMedusaUpdateToDirectus(product);
            }
        }
        console.log("Fetching deleted Medusa products...");
        const allSyncedProducts = await SyncModel.find();
        // Check for deleted products in Medusa
        for (const syncedProduct of allSyncedProducts) {
            const medusaProductExists = medusaProducts.some(product => product.id === syncedProduct.medusaId);
            if (!medusaProductExists) {
                await syncMedusaDeleteToDirectus(syncedProduct.medusaId);
            }
        }
    }
    catch (error) {
        console.error("Error during bidirectional sync:", error.message);
        throw error;
    }
};
// Trigger the bidirectional sync periodically
setInterval(() => {
    console.log("Starting periodic sync...");
    bidirectionalSync().catch((error) => console.error("Periodic sync failed:", error.message));
}, 60000); // Sync every minute
// Connect to MongoDB and start the initial sync
connectDB()
    .then(() => {
    console.log("MongoDB connected. Starting initial sync...");
    bidirectionalSync().catch((error) => console.error("Initial sync failed:", error.message));
})
    .catch((error) => {
    console.error("Error connecting to MongoDB:", error.message);
});
