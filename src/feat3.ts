import { createDirectus, rest, staticToken, createItem, updateItem, readItems, deleteItem } from "@directus/sdk";
import axios from "axios";
import { v4 as uuid4 } from "uuid";
import { connectDB } from "./connectDB.js";
import { SyncModel } from "./feat2.js";

// Configure Directus SDK and Axios for Medusa
const DIRECTUS_URL = "http://127.0.0.1:8055";
const DIRECTUS_API_TOKEN = "4areaTkf4uafC_Gz10SvOt_FLPc-Ugkj";
const MEDUSA_URL = "http://127.0.0.1:9000";
const MEDUSA_API_TOKEN ="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY3Rvcl9pZCI6InVzZXJfMDFKSFQyOUYxQzFQV0dRWVhSMkY1MDk5TVoiLCJhY3Rvcl90eXBlIjoidXNlciIsImF1dGhfaWRlbnRpdHlfaWQiOiJhdXRoaWRfMDFKSFQyOUVYQ0M5RkoySktaUk5FMzMzSlEiLCJhcHBfbWV0YWRhdGEiOnsidXNlcl9pZCI6InVzZXJfMDFKSFQyOUYxQzFQV0dRWVhSMkY1MDk5TVoifSwiaWF0IjoxNzM3MTE1ODEzLCJleHAiOjE3MzcyMDIyMTN9.WRa-nLvmJmYEvEAf1S9s41hv-_8lK8EzEFaegWP7i8A";

const directus = createDirectus(DIRECTUS_URL)
  .with(staticToken(DIRECTUS_API_TOKEN))
  .with(rest());

const axiosInstance = axios.create({
  baseURL: MEDUSA_URL + "/admin",
  headers: {
    Authorization: `Bearer ${MEDUSA_API_TOKEN}`,
  },
});

// Helper function to generate a handle for the product name
const generateHandle = (name: string, productId: string) => {
  if (!name) {
    return `product-${productId}`; // Use productId if name is not available
  }
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-");
};

// Helper function to check if the product handle already exists in Medusa
const checkIfProductExists = async (handle: string) => {
  try {
    const response = await axiosInstance.get(`/products?handle=${handle}`);
    return response.data && response.data.length > 0;
  } catch (error) {
    console.error(`Error checking if product exists with handle ${handle}:`, error.message || error);
    return false; // Return false in case of error
  }
};

// Retry function for handling database query failures
const retryFindProduct = async (query, retries = 3) => {
  while (retries > 0) {
    try {
      const result = await SyncModel.findOne(query);
      return result;
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.error("Failed after 3 retries:", error.message || error);
        throw error; // Rethrow if retries are exhausted
      }
      console.log(`Retrying... attempts left: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 second before retrying
    }
  }
};

// Function to sync a new product from Directus to Medusa
const syncNewProduct = async (product: any, update?: string) => {
  try {
    let handle = generateHandle(product.productName, product.id); // Ensure a unique handle

    // Retry logic for generating a unique handle
    let attempts = 0;
    let productExists = await checkIfProductExists(handle);
    
    while (productExists && attempts < 3) {
      // Retry with a new handle
      handle = generateHandle(`${product.productName}-${uuid4()}`, product.id);
      productExists = await checkIfProductExists(handle);
      attempts++;
    }

    // If still exists after retry attempts, log and stop further attempts
    if (productExists) {
      console.error(`Unable to generate a unique handle for product ${product.id} after ${attempts} attempts`);
      return; // Exit early without proceeding with this product
    }

    const formatProductData = {
      title: product.productName || String(uuid4()),
      status: "Published",
      description: product.description || "No description provided",
      handle,
      thumbnail:
        product.images && product.images.length > 0
          ? product.images[0].url
          : "https://media.ldlc.com/ld/products/00/05/44/00/LD0005440098_2_0005440176_0005440261.jpg",
      images:
        product.images && product.images.length > 0
          ? product.images.map((image) => ({
              url: image.url || "https://media.ldlc.com/ld/products/00/05/44/00/LD0005440098_2_0005440176_0005440261.jpg",
              id: uuid4(),
            }))
          : undefined,
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
      response = await axiosInstance.post(`/products/${update}`, formatProductData);
    } else {
      response = await axiosInstance.post("/products", formatProductData);
    }

    return response.data;
  } catch (error) {
    console.error("Error syncing new product to Medusa:", error.response?.data || error.message);
    throw new Error("Failed to sync product to Medusa");
  }
};

// Function to sync products from Directus to Medusa
const syncProducts = async () => {
  try {
    console.log("Syncing products...");
    const directusData = await directus.request(readItems("product"));

    for (const product of directusData) {
      try {
        // Attempt to find existing synced product
        const syncedProduct = await retryFindProduct({ directusId: product.id });

        if (syncedProduct) {
          // If product exists in Medusa, update it
          await syncNewProduct(product, syncedProduct.medusaId);
          console.log(`Product ${product.id} updated in Medusa.`);
        } else {
          // If product doesn't exist, create a new one
          const result = await syncNewProduct(product);
          if (result) {
            await SyncModel.create({
              medusaid: result.product.id,
              directusId: product.id,
              directusName: result.name,
              description: product.description,
              images: product.images,
            });
            console.log("Product synced with Medusa:", result);
          }
        }
      } catch (error) {
        console.error(`Error syncing product ${product.id}:`, error.message || error);
        // Optionally, retry the operation or log it for manual review
      }
    }
    console.log("Products synced successfully.");
  } catch (error) {
    console.error("Error fetching Directus data:", error.message || error);
  }
};

// Function to sync deleted products
const syncDeletedProducts = async () => {
  try {
    console.log("Syncing deleted products...");
    const directusData = await directus.request(readItems("product", { filter: { deleted_at: { _ne: null } } }));

    for (const product of directusData) {
      try {
        const syncedProduct = await retryFindProduct({ directusId: product.id });

        if (syncedProduct) {
          // If the product is marked for deletion, delete it from Medusa
          await deleteProduct(syncedProduct.medusaId);
          await SyncModel.deleteOne(syncedProduct.id);
          console.log(`Deleted product ${product.id} from Medusa.`);
        }
      } catch (error) {
        console.error(`Error deleting product ${product.id}:`, error.message || error);
      }
    }
    console.log("Deleted products synced successfully.");
  } catch (error) {
    console.error("Error syncing deleted products:", error.message || error);
  }
};

// Function to delete a product from Medusa
const deleteProduct = async (medusaProductId: string) => {
  try {
    const response = await axiosInstance.delete(`/products/${medusaProductId}`);
    console.log(`Product ${medusaProductId} deleted from Medusa.`);
    return response.data;
  } catch (error) {
    console.error("Error deleting product from Medusa:", error.response?.data || error.message);
    throw new Error("Failed to delete product from Medusa");
  }
};

// Periodic sync function to keep syncing products every minute
const periodicSync = async () => {
  try {
    await syncProducts();
    await syncDeletedProducts();
  } catch (error) {
    console.error("Periodic sync failed:", error.message || error);
  }
};

// Start syncing every 60 seconds (1 minute)
setInterval(periodicSync, 60000); // Sync every minute

// Run an initial sync before starting the interval
periodicSync();
connectDB();
