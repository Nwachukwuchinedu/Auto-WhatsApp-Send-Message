import express from "express";
import venom from "venom-bot";
import axios from "axios";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import mongoose from "mongoose";
import AdmZip from "adm-zip";
import fsExtra from "fs-extra";
import streamifier from "streamifier"; // For converting Buffer to stream

dotenv.config();

// Resolve __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// App and Port Setup
const app = express();
const PORT = process.env.PORT || 5000;
app.use(express.json());

// Environment Variables
const FETCH_API_URL = process.env.FETCH_API_URL;
const SEND_MESSAGE_ENDPOINT = process.env.SEND_MESSAGE_ENDPOINT;
const GROUP_ID = process.env.GROUP_ID;
const MONGO_URI = process.env.MONGO_URI;

if (!FETCH_API_URL || !SEND_MESSAGE_ENDPOINT || !GROUP_ID || !MONGO_URI) {
  console.error(
    "Environment variables FETCH_API_URL, SEND_MESSAGE_ENDPOINT, GROUP_ID, and MONGO_URI are required."
  );
  process.exit(1);
}

/* ---------- Global Variables and Venom Client Initialization ---------- */
let cachedQRCode = null;
let isClientReady = false;
let client; // will hold the venom-bot client instance

// Create the venom client. (No need to pass sessionData here since venom‑bot reads the tokens folder.)
venom
  .create(
    "whatsapp-bot", // session name (venom‑bot uses the tokens/whatsapp-bot folder)
    (base64Qr, asciiQR, attempts, urlCode) => {
      console.log("QR code received:\n", asciiQR);
      // Save or cache QR code if needed (for example, to serve via an endpoint)
      // Prepare the QR code URL for your front-end (if needed)
      if (base64Qr.startsWith("data:")) {
        cachedQRCode = base64Qr;
      } else {
        cachedQRCode = "data:image/png;base64," + base64Qr;
      }
    },
    undefined,
    {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    }
  )
  .then((venomClient) => {
    client = venomClient;
    isClientReady = true;
    console.log("✅ WhatsApp client is ready!");

    // Start your bot processes here…
    initiateMessageSending();

    // Listen to state changes if needed.
    client.onStateChange((state) => {
      console.log("Client state changed:", state);
      if (
        state === "CONFLICT" ||
        state === "UNPAIRED" ||
        state === "UNPAIRED_IDLE"
      ) {
        console.log("Client disconnected. Attempting to reconnect...");
        client.useHere();
      }
    });


  })
  .catch((error) => {
    console.error("Error initializing venom client:", error);
  });
/* ---------- EXPRESS ROUTES ---------- */

// Serve the index.html file
app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "index.html");
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(500).send("Error loading the page");
    } else {
      console.log("HTML file sent successfully");
    }
  });
});

// Endpoint to retrieve the current QR code (if a new one is being generated)
app.get("/qr-code", (req, res) => {
  if (cachedQRCode) {
    return res.json({ qrCodeUrl: cachedQRCode });
  }
  res.status(202).json({
    message: "QR code generation in progress. Please try again shortly.",
  });
});

// Endpoint to check if the WhatsApp client is ready
app.get("/client-ready", (req, res) => {
  if (isClientReady) {
    res.json({ clientStatus: "Client is ready" });
  } else {
    res.status(404).json({ clientStatus: "Client not ready" });
  }
});

// API Endpoint to send a message to a group via HTTP POST
app.post("/send-group-message", async (req, res) => {
  const { groupId, message } = req.body;

  if (!groupId || !message) {
    return res.status(400).json({ error: "groupId and message are required" });
  }

  try {
    // Brief delay before sending the message
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await client.sendText(groupId, message);
    return res.status(200).json({ success: "Message sent successfully!" });
  } catch (error) {
    console.error("Error sending message:", error);
    return res.status(500).json({ error: "Failed to send message." });
  }
});

/* ---------- WHATSAPP BOT FUNCTIONS (Course fetching, sending messages, etc.) ---------- */

// Function to fetch courses from an external API
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

// Function to send a text message to a group using venom
async function sendMessageToGroup(groupId, message) {
  try {
    await client.sendText(groupId, message);
    console.log("Message sent successfully!");
  } catch (error) {
    console.error("Error sending message:", error.message);
  }
}

// Function to format the course message
function formatMessage(course) {
  const link =
    course.id_name && course.coupon_code
      ? `https://course-orbit.vercel.app/course/${course.id}`
      : "N/A";

  return `📚 *Course Title*: ${course.title}\n\n📝 *Headline*: _${course.headline}_\n\n🎯 *Level*: ${course.instructional_level_simple}\n\n🕒 *Duration*: ${course.content_info_short}\n\n🆓 *Enrolls Left*: ${course.coupon_uses_remaining}\n\n🌐 *Language*: ${course.language}\n\n⭐ *Rating*: ${course.rating}\n\n📂 *Category*: ${course.primary_category}\n\n🏷️ *Sub Category*: ${course.primary_subcategory}\n\n🔗 *Link*: ${link}`;
}

// Function to download an image from a URL
async function downloadImage(imageUrl) {
  try {
    const timestamp = Date.now();
    const filePath = path.resolve(__dirname, `temp_image_${timestamp}.jpg`);

    const response = await axios({
      url: imageUrl,
      method: "GET",
      responseType: "stream",
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(filePath));
      writer.on("error", reject);
    });
  } catch (error) {
    console.error("Error downloading image:", error.message);
    return null;
  }
}

// Function to delete a file from the file system
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

// Function to send an image message to a group using venom
async function sendImageToGroup(groupId, imagePath, caption) {
  try {
    const filename = path.basename(imagePath);
    await client.sendImage(groupId, imagePath, filename, caption);
  } catch (error) {
    console.error("Error sending image:", error.message);
  }
}

// Main function to fetch courses and send messages/images at intervals
async function startSendingMessages() {
  const courses = await fetchCourses();
  console.log(`Number of courses to send: ${courses.length}`);

  // Process each course sequentially
  courses.forEach(async (course) => {
    const caption = formatMessage(course);

    if (course.image) {
      try {
        console.log(`Downloading image for course: ${course.title}`);
        const imagePath = await downloadImage(course.image);

        if (imagePath) {
          console.log(
            `Sending image for course: ${course.title}, File: ${imagePath}`
          );
          await sendImageToGroup(GROUP_ID, imagePath, caption);
          cleanupFile(imagePath);
        } else {
          console.error(`Failed to download image for course: ${course.title}`);
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

    // Wait 90 seconds before processing the next course
    await new Promise((resolve) => setTimeout(resolve, 90 * 1000));
  });

  console.log("Finished sending messages.");
}

// Function to repeatedly initiate the message sending process
async function initiateMessageSending() {
  console.log("Starting message sending process...");
  await startSendingMessages();
  // After finishing one round, wait 90 seconds and start again
  setTimeout(initiateMessageSending, 90 * 1000);
}

/* ---------- Start the Express Server ---------- */
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
