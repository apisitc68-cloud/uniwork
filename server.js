const express = require("express");
const path = require("path");
require("dotenv").config();

const db = require("./config/database");
const authRoutes = require("./routes/auth");
const jobsRoutes = require("./routes/jobs");
const applicationsRoutes = require("./routes/applications");
const notificationsRoutes = require("./routes/notifications");
const uploadRoutes = require("./routes/upload");
const profileRoutes = require("./routes/profile");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

// ตั้งค่าการรับข้อมูล
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// เปิดหน้าเว็บไซต์
app.use(express.static(path.join(__dirname, "public")));

// เชื่อมต่อ API Routes
app.use("/api/auth", authRoutes);
app.use("/api/jobs", jobsRoutes);
app.use("/api/applications", applicationsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/admin", adminRoutes);

// ตรวจสอบการเชื่อมต่อ MySQL
app.get("/api/health", async (req, res) => {
    try {
        await db.query("SELECT 1");

        res.json({
            success: true,
            message: "UniWork connected to MySQL!"
        });
    } catch (error) {
        console.error("Database health error:", error.message);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

// ตรวจสอบ API ที่ไม่มีอยู่
app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "ไม่พบ API ที่ต้องการ"
    });
});

// เริ่มต้นเซิร์ฟเวอร์
async function startServer() {
    try {
        await db.query("SELECT 1");

        console.log("MySQL Connected Successfully!");

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`UniWork running on port ${PORT}`);
        });
    } catch (error) {
        console.error("Database Connection Error:", error.message);
        process.exit(1);
    }
}

startServer();
