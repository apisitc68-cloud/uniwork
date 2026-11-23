const express = require("express");
const router = express.Router();

const db = require("../config/database");
const jwt = require("jsonwebtoken");

// ตรวจสอบ Token
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "กรุณาเข้าสู่ระบบก่อน"
        });
    }

    try {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is not configured");
        }

        const token = authHeader.split(" ")[1];
        req.user = jwt.verify(token, process.env.JWT_SECRET);

        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Token ไม่ถูกต้องหรือหมดอายุ"
        });
    }
}

// ตรวจสอบข้อมูลข้อความ
function cleanText(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    if (typeof value !== "string") {
        return undefined;
    }

    return value.trim() || null;
}

// GET: ดูโปรไฟล์ของตัวเอง
// GET /api/profile/me
router.get("/me", verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        if (!userId || !["student", "employer"].includes(role)) {
            return res.status(401).json({
                success: false,
                message: "ข้อมูลบัญชีไม่ถูกต้อง"
            });
        }

        const [users] = await db.query(
            `SELECT id, full_name, email, role, created_at
             FROM users
             WHERE id = ?
             LIMIT 1`,
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบบัญชีผู้ใช้งาน"
            });
        }

        let profile = {};

        if (role === "student") {
            const [rows] = await db.query(
                "SELECT * FROM student_profiles WHERE user_id = ?",
                [userId]
            );

            profile = rows.length > 0 ? rows[0] : {};
        } else {
            const [rows] = await db.query(
                `SELECT e.company_name, p.*
                 FROM employers e
                 LEFT JOIN employer_profiles p ON p.user_id = e.user_id
                 WHERE e.user_id = ?
                 LIMIT 1`,
                [userId]
            );

            if (rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "ไม่พบข้อมูลบริษัท"
                });
            }

            profile = rows[0];
        }

        return res.json({
            success: true,
            data: {
                user: users[0],
                profile
            }
        });

    } catch (error) {
        console.error("Get profile error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดโปรไฟล์ได้"
        });
    }
});


// PUT: แก้ไขโปรไฟล์ของตัวเอง
// PUT /api/profile/me
router.put("/me", verifyToken, async (req, res) => {
    const connection = await db.getConnection();

    try {
        const userId = req.user.id;
        const role = req.user.role;

        if (!userId || !["student", "employer"].includes(role)) {
            return res.status(401).json({
                success: false,
                message: "ข้อมูลบัญชีไม่ถูกต้อง"
            });
        }

        const body = req.body || {};

        await connection.beginTransaction();

        if (role === "student") {
            const fields = [
                "full_name",
                "phone",
                "university",
                "faculty",
                "major",
                "year_level",
                "skills",
                "experience"
            ];

            for (const field of fields) {
                if (
                    Object.prototype.hasOwnProperty.call(body, field) &&
                    body[field] !== null &&
                    typeof body[field] !== "string"
                ) {
                    await connection.rollback();

                    return res.status(400).json({
                        success: false,
                        message: `ข้อมูล ${field} ไม่ถูกต้อง`
                    });
                }
            }

            if (body.full_name !== undefined) {
                const fullName = cleanText(body.full_name);

                if (!fullName) {
                    await connection.rollback();

                    return res.status(400).json({
                        success: false,
                        message: "กรุณากรอกชื่อ-นามสกุล"
                    });
                }

                await connection.query(
                    "UPDATE users SET full_name = ? WHERE id = ?",
                    [fullName, userId]
                );
            }

            const values = [
                cleanText(body.phone),
                cleanText(body.university),
                cleanText(body.faculty),
                cleanText(body.major),
                cleanText(body.year_level),
                cleanText(body.skills),
                cleanText(body.experience)
            ];

            const fieldsToSave = [
                "phone",
                "university",
                "faculty",
                "major",
                "year_level",
                "skills",
                "experience"
            ];

            const updates = [];
            const params = [];

            fieldsToSave.forEach((field, index) => {
                if (Object.prototype.hasOwnProperty.call(body, field)) {
                    if (values[index] === undefined) {
                        throw new Error(`Invalid value for ${field}`);
                    }

                    updates.push(`${field} = VALUES(${field})`);
                    params.push(values[index]);
                }
            });

            if (updates.length > 0) {
                await connection.query(
                    `INSERT INTO student_profiles
                     (user_id, ${fieldsToSave.filter(f =>
                        Object.prototype.hasOwnProperty.call(body, f)
                     ).join(", ")})
                     VALUES (${Array(
                        1 + fieldsToSave.filter(f =>
                            Object.prototype.hasOwnProperty.call(body, f)
                        ).length
                     ).fill("?").join(", ")})
                     ON DUPLICATE KEY UPDATE ${updates.join(", ")}`,
                    [
                        userId,
                        ...fieldsToSave
                            .map((field, index) => ({
                                field,
                                value: values[index]
                            }))
                            .filter(item =>
                                Object.prototype.hasOwnProperty.call(body, item.field)
                            )
                            .map(item => item.value)
                    ]
                );
            }

        } else {
            const fields = [
                "company_name",
                "business_type",
                "address",
                "phone",
                "description"
            ];

            for (const field of fields) {
                if (
                    Object.prototype.hasOwnProperty.call(body, field) &&
                    body[field] !== null &&
                    typeof body[field] !== "string"
                ) {
                    await connection.rollback();

                    return res.status(400).json({
                        success: false,
                        message: `ข้อมูล ${field} ไม่ถูกต้อง`
                    });
                }
            }

            if (body.company_name !== undefined) {
                const companyName = cleanText(body.company_name);

                if (!companyName) {
                    await connection.rollback();

                    return res.status(400).json({
                        success: false,
                        message: "กรุณากรอกชื่อบริษัท"
                    });
                }

                await connection.query(
                    "UPDATE employers SET company_name = ? WHERE user_id = ?",
                    [companyName, userId]
                );
            }

            const profileFields = [
                "business_type",
                "address",
                "phone",
                "description"
            ];

            const selectedFields = profileFields.filter(field =>
                Object.prototype.hasOwnProperty.call(body, field)
            );

            if (selectedFields.length > 0) {
                const values = selectedFields.map(field =>
                    cleanText(body[field])
                );

                await connection.query(
                    `INSERT INTO employer_profiles
                     (user_id, ${selectedFields.join(", ")})
                     VALUES (${Array(selectedFields.length + 1).fill("?").join(", ")})
                     ON DUPLICATE KEY UPDATE ${
                        selectedFields.map(field =>
                            `${field} = VALUES(${field})`
                        ).join(", ")
                     }`,
                    [userId, ...values]
                );
            }
        }

        await connection.commit();

        return res.json({
            success: true,
            message: "บันทึกโปรไฟล์สำเร็จ"
        });

    } catch (error) {
        await connection.rollback();

        console.error("Update profile error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถบันทึกโปรไฟล์ได้"
        });

    } finally {
        connection.release();
    }
});

module.exports = router;
