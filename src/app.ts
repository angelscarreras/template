import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { Client } from "minio";
import crypto from "crypto";
import dotenv from "dotenv";

// Carga las variables de entorno desde el archivo .env
dotenv.config();

// Inicializa la aplicación Express
const app = express();
app.use(bodyParser.json());

const externalMinioDomain = process.env.PUBLIC_MINIO_DOMAIN || "localhost";
const internalMinioDomain =
  process.env.MINIO_ENDPOINT || "host.docker.internal";
const minioPort = parseInt(process.env.MINIO_PORT || "9000");

// Configuración de MinIO
const minioClient = new Client({
  endPoint: internalMinioDomain,
  port: minioPort,
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ROOT_USER || "minioadmin",
  secretKey: process.env.MINIO_ROOT_PASSWORD || "minioadmin",
});

// Bucket de destino en MinIO
const bucketName = process.env.MINIO_BUCKET || "pdfs";

// Lee el archivo HTML de la plantilla
const getSangriaFiesta = (data: any): string => {
  const filePath = path.join(__dirname, "../templates/sangria-fiesta.html");
  let html = fs.readFileSync(filePath, "utf8");

  // Reemplaza los marcadores de posición en la plantilla con los datos del JSON
  html = html.replace(/{{restaurant_name}}/g, data.restaurant_name);
  html = html.replace(/{{time}}/g, data.time);
  html = html.replace(/{{date}}/g, data.date);
  html = html.replace(/{{address}}/g, data.address);
  html = html.replace(/{{email}}/g, data.email);

  return html;
};

async function createBucket() {
  try {
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, "");
      const policy = {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: [
              "s3:GetObject", // Allows read access to objects
            ],
            Resource: [
              `arn:aws:s3:::${bucketName}/*`, // Applies to all objects in the bucket
            ],
          },
        ],
      };
      await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
      console.log(`Bucket ${bucketName} is now publicly accessible.`);
    }
  } catch (error) {
    console.error("Error setting public policy:", error);
  }
}
// Función para subir el PDF a MinIO
const uploadToMinio = async (pdfBuffer: Buffer): Promise<string> => {
  const pdfName = `sangria-fiesta-${crypto.randomUUID()}.pdf`;
  const metaData = {
    "Content-Type": "application/pdf",
  };

  // Sube el archivo PDF a MinIO
  await minioClient.putObject(
    bucketName,
    pdfName,
    pdfBuffer,
    undefined,
    metaData
  );

  // Genera un enlace público al PDF
  const expiry = 7 * 24 * 60 * 60; // Enlace válido por 24 horas
  const url = await minioClient.presignedGetObject(bucketName, pdfName, expiry);

  const publicUrl = url
    .split("?")[0]
    .replace(`${internalMinioDomain}:${minioPort}`, externalMinioDomain)
    .replace("http", "https");

  return publicUrl;
};

// Endpoint POST que recibe datos JSON y los convierte en PDF y guarda en MinIO
app.post("/sangria-fiesta", async (req: Request, res: Response) => {
  try {
    const data = req.body;

    // Obtiene el contenido HTML con los datos reemplazados
    const htmlContent = getSangriaFiesta(data);

    // Opciones de configuración para el PDF
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    await page.waitForSelector("body");
    // await page.screenshot({ path: "screenshot.png", fullPage: true });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true, // Incluir fondos y colores
      margin: {
        top: "20px",
        right: "20px",
        bottom: "20px",
        left: "20px",
      },
      pageRanges: "1", // Solo imprimir la primera página
    });
    const pdfBuffer = Buffer.from(pdf);
    await browser.close();

    // Sube el PDF a MinIO y obtiene el enlace público
    const publicUrl = await uploadToMinio(pdfBuffer);
    // const fs = require("fs");
    // const path = require("path");

    // Define the local path where the PDF will be saved
    // const localPdfPath = path.join(__dirname, "sangria-fiesta.pdf");

    // Save the PDF buffer to a local file
    // fs.writeFileSync(localPdfPath, pdfBuffer);

    // console.log(`PDF saved locally at ${localPdfPath}`);

    // Devuelve el enlace público al cliente
    res.json({ url: publicUrl });
  } catch (error) {
    console.error("Error generando PDF o subiendo a MinIO:", error);
    res.status(500).json({ message: "Error generando PDF o subiendo a MinIO" });
  }
});

// Inicia el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await createBucket();
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
