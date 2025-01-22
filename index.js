import express from "express";
import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const { Client, LocalAuth } = pkg;

const app = express();
const PORT = process.env.PORT || 3000;

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

// WhatsApp Client Configuration
const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  console.log("Scan this QR code to log in:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("WhatsApp client is ready!");

  // Start the process
  initiateMessageSending();
});

client.initialize();

// Middleware to parse JSON
app.use(express.json());

// API Endpoint to send a message to a group
app.post("/send-group-message", async (req, res) => {
  const { groupId, message } = req.body;

  if (!groupId || !message) {
    return res.status(400).json({ error: "groupId and message are required" });
  }

  try {
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
    console.error("Error sending message:", error.message);
  }
}

// Format the message
function formatMessage(course) {
 const link =
   course.id_name && course.coupon_code
     ? `[Click here](https://www.udemy.com/course/${course.id_name}/?couponCode=${course.coupon_code})`
     : "N/A";

  return `📚 *Course Title*: ${course.title}\n📝 *Headline*: ${course.headline}\n🎯 *Level*: ${course.instructional_level_simple}\n🕒 *Duration*: ${course.content_info_short}\n🆓 *Enrolls Left*: ${course.coupon_uses_remaining}\n🌐 *Language*: ${course.language}\n⭐ *Rating*: ${course.rating}\n📂 *Category*: ${course.primary_category}\n🏷️ *Sub Category*: ${course.primary_subcategory}\n🔗 *Link*: ${link}`;
}

// Main function to fetch and send messages at intervals
async function startSendingMessages() {
  const courses = await fetchCourses();
  console.log(`length of courses: ${courses.length}`);

  courses.forEach(async (course) => {
    const message = formatMessage(course);
    await sendMessageToGroup(GROUP_ID, message);
    // Wait for 90 seconds before sending the next message
    await new Promise((resolve) => setTimeout(resolve, 90000));
  });

  console.log("Finished sending messages.");
}

// Sequentially trigger message sending
async function initiateMessageSending() {
  console.log("Starting message sending process...");
  await startSendingMessages();
  setTimeout(initiateMessageSending, 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
