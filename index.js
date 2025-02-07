import express from "express";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs"; // Import to handle file operations
import { MongoStore } from "wwebjs-mongo";
import mongoose from "mongoose";
// import chromium from "@sparticuz/chromium";
// import puppeteer from "puppeteer-extra";
// import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Use the StealthPlugin to enhance Puppeteer's stealth capabilities
// puppeteer.use(StealthPlugin());

// To resolve __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const { Client, RemoteAuth, MessageMedia } = pkg;

const app = express();
const PORT = process.env.PORT || 5000;

// Environment variables
const FETCH_API_URL = process.env.FETCH_API_URL;
const SEND_MESSAGE_ENDPOINT = process.env.SEND_MESSAGE_ENDPOINT;
const GROUP_ID = process.env.GROUP_ID;

if (!FETCH_API_URL || !SEND_MESSAGE_ENDPOINT || !GROUP_ID) {
  console.error(
    "Environment variables FETCH_API_URL, SEND_MESSAGE_ENDPOINT, and GROUP_ID are required."
  );
  process.exit(1);
}

// 🔗 Replace with your actual MongoDB Atlas URI
const MONGO_URI = process.env.MONGO_URI;

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

(async () => {
  await connectDB(); // Connect to MongoDB

  // ✅ Initialize MongoStore
  const store = new MongoStore({ mongoose: mongoose });

  const client = new Client({
    authStrategy: new RemoteAuth({
      clientId: "whatsapp-bot",
      store: store,
      backupSyncIntervalMs: 60000,
    }), // ✅ Use MongoStore for session storage
    // puppeteer: {

    //   // executablePath: await chromium.executablePath(), // ✅ Use lightweight Chromium
    //   // headless: chromium.headless,
    //   // args: [
    //   //   "--no-sandbox",
    //   //   "--disable-setuid-sandbox",
    //   //   "--disable-dev-shm-usage",
    //   //   "--disable-gpu",
    //   //   "--disable-software-rasterizer",
    //   //   "--no-zygote",
    //   //   "--single-process",
    //   // ],
    // },
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });

  client.on("authenticated", (session) => {
    console.log("Authenticated!");
  });

  // Route to serve the index.html file from the root of the project
  app.get("/", (req, res) => {
    // Use path.join to create the correct path to index.html
    const filePath = path.join(__dirname, "index.html");

    // Send the HTML file
    res.sendFile(filePath, (err) => {
      if (err) {
        console.log("Error sending file:", err);
        res.status(500).send("Error loading the page");
      } else {
        console.log("HTML file sent successfully");
      }
    });
  });

  // Variable to cache the latest QR code
  let cachedQRCode = null;
  let qrCodeGenerationInProgress = false;

  // QR Code generation logic
  client.on("qr", (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
      if (err) {
        console.error("Error generating QR code:", err);
        cachedQRCode = null;
      } else {
        cachedQRCode = url; // Cache the generated QR code
      }
    });
  });

  // Endpoint to get QR code
  app.get("/qr-code", (req, res) => {
    if (cachedQRCode) {
      // Serve the cached QR code
      return res.json({ qrCodeUrl: cachedQRCode });
    }

    if (!qrCodeGenerationInProgress) {
      // Notify the client is initializing and QR code will be ready soon
      qrCodeGenerationInProgress = true;
      res.status(202).json({
        message: "QR code generation in progress. Please try again shortly.",
      });
    } else {
      // If still in progress, notify the user
      res.status(202).json({
        message: "QR code generation still in progress. Please wait.",
      });
    }
  });

  // When the client is ready
  client.on("ready", async () => {
    console.log("WhatsApp client is ready!");
    // 💾 Save session when client is ready
    cachedQRCode = null; // Clear cached QR code once the client is ready
    isClientReady = true;
  });

  // Client ready status
  let isClientReady = false;

  // Update the 'ready' event for WhatsApp client
  client.on("ready", () => {
    console.log("WhatsApp client is ready!");
    initiateMessageSending();

    // Set the client ready flag
    isClientReady = true;
  });

  // Endpoint to check client status
  app.get("/client-ready", (req, res) => {
    if (isClientReady) {
      res.json({ clientStatus: "Client is ready" });
    } else {
      res.status(404).json({ clientStatus: "Client not ready" });
    }
  });

  client.on("disconnected", async (reason) => {
    console.log(`⚠ Client disconnected! Reason: ${reason}`);

    // Delay before reinitializing to prevent crash loops
    setTimeout(async () => {
      console.log("🔄 Restarting client...");
      await client.initialize();
    }, 5000); // Wait 5 seconds before reconnecting
  });

  client.initialize();
  // Middleware to parse JSON
  app.use(express.json());

  const filePath = "RemoteAuth-whatsapp-bot.zip";

  setInterval(() => {
    if (fs.existsSync(filePath)) {
      console.log("File exists, waiting before processing...");
      setTimeout(() => {
        if (fs.existsSync(filePath)) {
          console.log("Processing file...");
        } else {
          console.log("File was deleted before processing.");
        }
      }, 3000); // Wait 3 seconds before checking again
    }
  }, 10000); // Check every 10 seconds

  // API Endpoint to send a message to a group
  app.post("/send-group-message", async (req, res) => {
    const { groupId, message } = req.body;

    if (!groupId || !message) {
      return res
        .status(400)
        .json({ error: "groupId and message are required" });
    }

    try {
      // Introduce a small delay before sending the message
      await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 seconds delay for preview

      const chat = await client.getChatById(groupId);
      await chat.sendMessage(message);
      return res.status(200).json({ success: "Message sent successfully!" });
    } catch (error) {
      console.error("Error sending message:", error);
      return res.status(500).json({ error: "Failed to send message." });
    }
  });

  // Function to fetch courses
  async function fetchCourses() {
    try {
      const response = await axios.post(FETCH_API_URL);
      if (!Array.isArray(response.data)) {
        console.error("Invalid response format from API");
        return [];
      }
      return response.data;
    } catch (error) {
      console.error("Error fetching courses:", error.message);
      return [];
    }
  }

  // Function to send a message
  async function sendMessageToGroup(groupId, message) {
    try {
      const response = await axios.post(SEND_MESSAGE_ENDPOINT, {
        groupId,
        message,
      });
      console.log("Message sent:", response.data);
    } catch (error) {
      console.error(
        "Error sending message:",
        error.response ? error.response.data : error.message
      );
    }
  }

  // Format the message
  function formatMessage(course) {
    const link =
      course.id_name && course.coupon_code
        ? `https://course-orbit.vercel.app/course/${course.id}`
        : "N/A";

    return `📚 *Course Title*: ${course.title}\n\n📝 *Headline*: _${course.headline}_\n\n🎯 *Level*: ${course.instructional_level_simple}\n\n🕒 *Duration*: ${course.content_info_short}\n\n🆓 *Enrolls Left*: ${course.coupon_uses_remaining}\n\n🌐 *Language*: ${course.language}\n\n⭐ *Rating*: ${course.rating}\n\n📂 *Category*: ${course.primary_category}\n\n🏷️ *Sub Category*: ${course.primary_subcategory}\n\n🔗 *Link*: ${link}`;
  }

  // // Main function to fetch and send messages at intervals
  // async function startSendingMessages() {
  //   const courses = await fetchCourses();
  //   console.log(`length of courses: ${courses.length}`);

  //   courses.forEach(async (course) => {
  //     const message = formatMessage(course);
  //     await sendMessageToGroup(GROUP_ID, message);
  //     // Wait for 90 seconds before sending the next message
  //     await new Promise((resolve) => setTimeout(resolve, 90 * 1000));
  //   });

  //   console.log("Finished sending messages.");
  // }

  // Function to download an image

  // Function to download an image
  async function downloadImage(imageUrl) {
    try {
      const timestamp = Date.now(); // Unique identifier
      const filePath = path.resolve(__dirname, `temp_image_${timestamp}.jpg`);

      const response = await axios({
        url: imageUrl,
        method: "GET",
        responseType: "stream",
      });

      // Write the image file
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      // Return a promise that resolves when the file is finished writing
      return new Promise((resolve, reject) => {
        writer.on("finish", () => resolve(filePath));
        writer.on("error", reject);
      });
    } catch (error) {
      console.error("Error downloading image:", error.message);
      return null;
    }
  }

  function cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted file: ${filePath}`);
      } else {
        console.warn(`File does not exist, skipping delete: ${filePath}`);
      }
    } catch (error) {
      console.error("Error deleting file:", error.message);
    }
  }

  // Function to send an image
  async function sendImageToGroup(groupId, imagePath, caption) {
    try {
      const media = MessageMedia.fromFilePath(imagePath);
      const chat = await client.getChatById(groupId);
      await chat.sendMessage(media, { caption });
      //console.log(`Image sent successfully with caption: ${caption}`);
    } catch (error) {
      console.error("Error sending image:", error.message);
    }
  }

  // Main function to fetch and send messages at intervals
  async function startSendingMessages() {
    const courses = await fetchCourses();
    console.log(`Number of courses to send: ${courses.length}`);

    courses.forEach(async (course) => {
      const caption = formatMessage(course); // Use the formatted message as the caption

      if (course.image) {
        try {
          console.log(`Downloading image for course: ${course.title}`);
          const imagePath = await downloadImage(course.image);

          if (imagePath) {
            console.log(
              `Sending image for course: ${course.title}, File: ${imagePath}`
            );
            await sendImageToGroup(GROUP_ID, imagePath, caption);
            cleanupFile(imagePath); // Clean up the downloaded file
          } else {
            console.error(
              `Failed to download image for course: ${course.title}`
            );
          }
        } catch (error) {
          console.error(
            `Error processing image for course: ${course.title}`,
            error.message
          );
        }
      } else {
        console.warn(`No image URL provided for course: ${course.title}`);
        try {
          console.log(`Sending text message for course: ${course.title}`);
          await sendMessageToGroup(GROUP_ID, caption);
        } catch (error) {
          console.error(
            `Error sending text message for course: ${course.title}`,
            error.message
          );
        }
      }

      // Wait for 90 seconds before processing the next course
      await new Promise((resolve) => setTimeout(resolve, 90 * 1000));
    });

    console.log("Finished sending messages.");
  }

  // Sequentially trigger message sending
  async function initiateMessageSending() {
    console.log("Starting message sending process...");
    await startSendingMessages();
    setTimeout(initiateMessageSending, 90 * 1000);
  }
})();

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
