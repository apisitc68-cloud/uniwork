const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

// ตรวจสอบ Token
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "กรุณาเข้าสู่ระบบ"
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Token ไม่ถูกต้องหรือหมดอายุ"
        });
    }
}

// ดึงรายการแจ้งเตือนของผู้ใช้
router.get("/", verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [notifications] = await db.query(
            "SELECT id, application_id, title, message, type, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
            [userId]
        );

        res.json({
            success: true,
            total: notifications.length,
            data: notifications
        });

    } catch (error) {
        console.error("Load notifications error:", error.message);
        res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดการแจ้งเตือนได้"
        });
    }
});

// นับจำนวนแจ้งเตือนที่ยังไม่ได้อ่าน
router.get("/unread-count", verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const [result] = await db.query(
            "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = FALSE",
            [userId]
        );

        res.json({
            success: true,
            count: result[0].count
        });

    } catch (error) {
        console.error("Unread count error:", error.message);
        res.status(500).json({
            success: false,
            message: "ไม่สามารถนับการแจ้งเตือนได้"
        });
    }
});

// อ่านการแจ้งเตือนรายรายการ
router.patch("/:id/read", verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const notificationId = req.params.id;

        const [result] = await db.query(
            "UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?",
            [notificationId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบการแจ้งเตือน"
            });
        }

        res.json({
            success: true,
            message: "อ่านการแจ้งเตือนแล้ว"
        });

    } catch (error) {
        console.error("Mark notification read error:", error.message);
        res.status(500).json({
            success: false,
            message: "ไม่สามารถอัปเดตการแจ้งเตือนได้"
        });
    }
});

// อ่านการแจ้งเตือนทั้งหมด
router.patch("/read-all", verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        await db.query(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE",
            [userId]
        );

        res.json({
            success: true,
            message: "อ่านการแจ้งเตือนทั้งหมดแล้ว"
        });

    } catch (error) {
        console.error("Mark all read error:", error.message);
        res.status(500).json({
            success: false,
            message: "ไม่สามารถอัปเดตการแจ้งเตือนได้"
        });
    }
});

module.exports = router;