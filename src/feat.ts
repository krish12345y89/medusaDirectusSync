import {
  createDirectus,
  rest,
  staticToken,
  createItem,
  updateItem,
  readItems,
  deleteItem,
} from "@directus/sdk";
import axios from "axios";
import { v4 as uuid4 } from "uuid";
import { Request, Response, NextFunction } from "express";
import { sync } from "./models/sync.js";

const DIRECTUS_URL = "http://127.0.0.1:8055";
const DIRECTUS_API_TOKEN = "FW3lp6CmNk4XG4lGmTnPdEBvPbnDK6-h";
const MEDUSA_URL = "http://127.0.0.1:9000";
const MEDUSA_API_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhY3Rvcl9pZCI6InVzZXJfMDFKSEc5R0RSOEExNE1NN1Y2WlFCNTBZOFQiLCJhY3Rvcl90eXBlIjoidXNlciIsImF1dGhfaWRlbnRpdHlfaWQiOiJhdXRoaWRfMDFKSEc5R0RQQ1kxQllIMTk3QUExNlhFQTYiLCJhcHBfbWV0YWRhdGEiOnsidXNlcl9pZCI6InVzZXJfMDFKSEc5R0RSOEExNE1NN1Y2WlFCNTBZOFQifSwiaWF0IjoxNzM3MDIwNzY0LCJleHAiOjE3MzcxMDcxNjR9.uyciCm3PTTdeYR7ms15pUN0CTt9QbWyjBORATWfReNI";

const directus = createDirectus(DIRECTUS_URL)
  .with(staticToken(DIRECTUS_API_TOKEN))
  .with(rest());

const axiosInstance = axios.create({
  baseURL: MEDUSA_URL + "/admin",
  headers: {
    Authorization: `Bearer ${MEDUSA_API_TOKEN}`,
  },
});

const syncNewProduct = async (product: any, update?: string) => {
  try {
    const generateHandle = (name: string) => {
      return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .replace(/\s+/g, "-");
    };

    const formatProductData = {
      title: product.name,
      status: "draft",
      description: product.description || "No description provided",
      handle: await generateHandle(product.name),
      thumbnail:
        product.images && product.images.length > 0
          ? product.images[0].url
          : "",
      images:
        product.images && product.images.length > 0
          ? product.images.map((image) => ({ url: image.url, id: uuid4() }))
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
      response = await axiosInstance.post(
        `/products/${update}`,
        formatProductData
      );
    } else {
      response = await axiosInstance.post("/products", formatProductData);
    }
    return response.data;
  } catch (error) {
    console.error(
      "Error syncing new product to Medusa:",
      error.response?.data || error.message
    );
    throw new Error("Failed to sync product to Medusa");
  }
};

const syn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const directusData = await directus.request(readItems("product"));
    for (const product of directusData) {
      try {
        const result = await syncNewProduct(product, product.id);
        const dt = await sync.create({
          medusaid: result.product.id,
          directusId: product.id,
          directusNmae: result.name,
          description: product.description,
          images: product.images,
        });
        console.log("Product updated in Medusa:", result);
      } catch (error) {
        console.error("Error updating product:", error);
      }
    }
  } catch (error) {}
};

export const createData = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = req.body;
    const files = req.files as Express.MulterS3.File[];

    const resu = await sync.findOne({ directusNmae: data.name });
    if (resu) {
      throw new Error("Product already exists");
    }

    let fileLocations: { url: string }[] = [];
    if (files) {
      files.forEach((file) => {
        fileLocations.push({ url: file.location });
      });
    }
    console.log(fileLocations);
    console.log(data);
    if (data) {
      const newData: any = {
        ...data,
        images: fileLocations,
      };
      const result = await directus.request(createItem("product", newData));
      const medusaResult = await syncNewProduct(newData);

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
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).send("Failed to create product");
  }
};

export const updateData = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const data = req.body;
    const files = req.files as Express.MulterS3.File[];
    const id = req.params.id;

    const ress = await sync.findOne({ directusId: id });
    if (!ress) {
      throw new Error("Item does not exist. Please create it first.");
    }

    data.name = data.name || ress.directusNmae;
    data.description = data.description || ress.description;
    let fileLocations: { url: string }[] = [];
    if (files) {
      files.forEach((file) => {
        fileLocations.push({ url: file.location });
      });
    }

    const newData: any = {
      ...data,
      images: files ? fileLocations : ress.images,
    };

    const result = await directus.request(updateItem("product", id, data));
    const updatedMedusaData = await syncNewProduct(newData, ress.medusaid);
    const updatedSync = await sync.updateOne(
      { directusId: id },
      {
        directusNmae: newData.name,
        description: newData.description,
        images: files ? fileLocations : ress.images,
        medusaid: updatedMedusaData.product.id,
      }
    );

    res.status(200).json({
      result,
      updatedMedusaData,
      updatedSync,
    });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).send("Failed to update product");
  }
};

export const readData = async (req: Request, res: Response) => {
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
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).send("Failed to read products");
  }
};

export const deleteData = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    const ress = await sync.findOne({ directusId: id });
    if (!ress) {
      throw new Error("Product not found. Nothing to delete.");
    }

    await directus.request(deleteItem("product", id));
    await axiosInstance.delete(`/products/${ress.medusaid}`);

    await sync.deleteOne({ directusId: id });

    res.status(200).send("Product deleted successfully from all systems.");
  } catch (error) {
    console.error("Error deleting product:", error.message || error);
    res.status(500).send("Failed to delete product.");
  }
};
