const express = require("express");
const router = express.Router();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

// =================================
// สมัครสมาชิก
// =================================
router.post("/register", async (req, res) => {
    let connection;

    try {
        const { full_name, email, password, role, company_name } = req.body;

        if (!full_name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "กรุณากรอกข้อมูลให้ครบ"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"
            });
        }

        const userRole = role || "student";

        if (!["student", "employer"].includes(userRole)) {
            return res.status(400).json({
                success: false,
                message: "ประเภทผู้ใช้ไม่ถูกต้อง"
            });
        }

        if (userRole === "employer" && !company_name?.trim()) {
            return res.status(400).json({
                success: false,
                message: "กรุณากรอกชื่อบริษัทหรือร้านค้า"
            });
        }

        connection = await db.getConnection();

        const [existingUser] = await connection.query(
            "SELECT id FROM users WHERE email = ?",
            [email.trim()]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({
                success: false,
                message: "อีเมลนี้ถูกใช้งานแล้ว"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        await connection.beginTransaction();

        const [userResult] = await connection.query(
            `INSERT INTO users
            (full_name, email, password_hash, role)
            VALUES (?, ?, ?, ?)`,
            [full_name.trim(), email.trim(), hashedPassword, userRole]
        );

        const userId = userResult.insertId;

        if (userRole === "employer") {
            await connection.query(
                `INSERT INTO employers (user_id, company_name)
                VALUES (?, ?)`,
                [userId, company_name.trim()]
            );
        }

        await connection.commit();

        return res.status(201).json({
            success: true,
            message: "สมัครสมาชิกสำเร็จ",
            userId: userId
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Register Error:", error);

        return res.status(500).json({
            success: false,
            message: "เกิดข้อผิดพลาดในการสมัครสมาชิก",
            error: error.message
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// =================================
// เข้าสู่ระบบ
// =================================
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "กรุณากรอกอีเมลและรหัสผ่าน"
            });
        }

        const [users] = await db.query(
            "SELECT * FROM users WHERE email = ?",
            [email.trim()]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: "ไม่พบอีเมลนี้ในระบบ"
            });
        }

        const user = users[0];

        const validPassword = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!validPassword) {
            return res.status(401).json({
                success: false,
                message: "รหัสผ่านไม่ถูกต้อง"
            });
        }

        const token = jwt.sign(
            {
                id: user.id,
                role: user.role
            },
            process.env.JWT_SECRET,
            {
                expiresIn: "1d"
            }
        );

        return res.json({
            success: true,
            message: "เข้าสู่ระบบสำเร็จ",
            token: token,
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Login Error:", error);

        return res.status(500).json({
            success: false,
            message: "เกิดข้อผิดพลาดในการเข้าสู่ระบบ",
            error: error.message
        });
    }
});

module.exports = router;
