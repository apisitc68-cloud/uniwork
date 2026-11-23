const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

const uploadDir = path.join(__dirname, "../public/uploads/profiles");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ตั้งค่าการจัดเก็บรูปภาพ
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const extension = path.extname(file.originalname).toLowerCase();

        cb(
            null,
            `user-${req.user.id}-${Date.now()}${extension}`
        );
    }
});

// ตรวจสอบประเภทและขนาดไฟล์
const upload = multer({
    storage,
    limits: {
        fileSize: 2 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(
                new Error("รองรับเฉพาะ JPG, PNG และ WEBP")
            );
        }

        cb(null, true);
    }
});

// ตรวจสอบ Token
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "กรุณาเข้าสู่ระบบ"
        });
    }

    try {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is missing");
        }

        const token = authHeader.split(" ")[1];

        req.user = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        if (!["student", "employer"].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "ไม่มีสิทธิ์ใช้งาน"
            });
        }

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Token ไม่ถูกต้องหรือหมดอายุ"
        });
    }
}

// POST: Upload Profile Image
router.post("/", verifyToken, (req, res) => {

    upload.single("profile_image")(req, res, async (error) => {

        if (error) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "กรุณาเลือกรูปภาพ"
            });
        }

        let connection;

        try {
            const userId = req.user.id;
            const role = req.user.role;

            // แยกตารางและคอลัมน์ตามประเภทบัญชี
            const table = role === "student"
                ? "student_profiles"
                : "employer_profiles";

            const imageColumn = role === "student"
                ? "profile_image"
                : "company_logo";

            const imageUrl =
                `/uploads/profiles/${req.file.filename}`;

            connection = await db.getConnection();

            await connection.beginTransaction();

            // ตรวจสอบรูปเดิม
            const [rows] = await connection.query(
                `SELECT ${imageColumn}
                 FROM ${table}
                 WHERE user_id = ?
                 LIMIT 1`,
                [userId]
            );

            const oldImage = rows.length > 0
                ? rows[0][imageColumn]
                : null;

            // บันทึกรูปใหม่
            await connection.query(
                `INSERT INTO ${table}
                    (user_id, ${imageColumn})
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE
                    ${imageColumn} = VALUES(${imageColumn})`,
                [userId, imageUrl]
            );

            await connection.commit();

            connection.release();
            connection = null;

            // ลบรูปเก่าหลังจากบันทึกรูปใหม่สำเร็จ
            if (oldImage) {
                const oldName = path.basename(oldImage);
                const oldPath = path.join(uploadDir, oldName);

                if (
                    oldName !== path.basename(imageUrl) &&
                    fs.existsSync(oldPath)
                ) {
                    fs.unlink(oldPath, (err) => {
                        if (err) {
                            console.error(
                                "Cannot delete old image:",
                                err.message
                            );
                        }
                    });
                }
            }

            return res.json({
                success: true,
                message: "อัปเดตรูปโปรไฟล์สำเร็จ",
                image_url: imageUrl,
                [imageColumn]: imageUrl
            });

        } catch (err) {

            if (connection) {
                await connection.rollback();
                connection.release();
            }

            // ลบไฟล์ใหม่หากบันทึกฐานข้อมูลไม่สำเร็จ
            fs.unlink(req.file.path, () => {});

            console.error("Upload profile error:", err);

            return res.status(500).json({
                success: false,
                message: "ไม่สามารถบันทึกรูปภาพได้"
            });
        }
    });
});

module.exports = router;