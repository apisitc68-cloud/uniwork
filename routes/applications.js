const express = require("express");
const router = express.Router();
const db = require("../config/database");
const jwt = require("jsonwebtoken");

// =====================================
// ตรวจสอบ Token
// =====================================
function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "กรุณาเข้าสู่ระบบก่อน"
        });
    }

    try {
        req.user = jwt.verify(
            authHeader.split(" ")[1],
            process.env.JWT_SECRET
        );
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Token ไม่ถูกต้องหรือหมดอายุ"
        });
    }
}

// =====================================
// ตรวจสอบประเภทบัญชี
// =====================================
function verifyRole(role) {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({
                success: false,
                message: "คุณไม่มีสิทธิ์ใช้งานส่วนนี้"
            });
        }
        next();
    };
}

// =====================================
// STUDENT: สมัครงาน
// POST /api/applications/:jobId
// =====================================
router.post("/:jobId", verifyToken, verifyRole("student"), async (req, res) => {
    try {
        const jobId = Number(req.params.jobId);
        const userId = req.user.id;

        const message = typeof req.body.message === "string"
            ? req.body.message.trim()
            : "";

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสประกาศงานไม่ถูกต้อง"
            });
        }

        const [jobs] = await db.query(
            "SELECT id FROM jobs WHERE id = ? AND status = 'open'",
            [jobId]
        );

        if (jobs.length === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบประกาศงานหรือประกาศนี้ปิดรับสมัครแล้ว"
            });
        }

        const [existing] = await db.query(
            "SELECT id FROM applications WHERE job_id = ? AND user_id = ?",
            [jobId, userId]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: "คุณสมัครงานนี้ไปแล้ว"
            });
        }

        const [result] = await db.query(
            "INSERT INTO applications (job_id, user_id, message) VALUES (?, ?, ?)",
            [jobId, userId, message || null]
        );

        return res.status(201).json({
            success: true,
            message: "สมัครงานสำเร็จ",
            applicationId: result.insertId
        });

    } catch (error) {
        console.error("Apply job error:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "คุณสมัครงานนี้ไปแล้ว"
            });
        }

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถสมัครงานได้"
        });
    }
});

// =====================================
// STUDENT: ดูประวัติการสมัครงาน
// GET /api/applications/my
// =====================================
router.get("/my", verifyToken, verifyRole("student"), async (req, res) => {
    try {
        const [applications] = await db.query(
            "SELECT a.id AS id, a.job_id, a.message, a.status, a.applied_at, j.title, j.location, j.salary_min, j.salary_max, j.pay_type, e.company_name FROM applications a JOIN jobs j ON a.job_id = j.id JOIN employers e ON j.employer_id = e.id WHERE a.user_id = ? ORDER BY a.applied_at DESC",
            [req.user.id]
        );

        return res.json({
            success: true,
            total: applications.length,
            data: applications
        });

    } catch (error) {
        console.error("Load student applications error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดประวัติการสมัครงานได้"
        });
    }
});

// =====================================
// EMPLOYER: ดูรายชื่อผู้สมัคร
// GET /api/applications/job/:jobId
// =====================================
router.get("/job/:jobId", verifyToken, verifyRole("employer"), async (req, res) => {
    try {
        const jobId = Number(req.params.jobId);

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสประกาศงานไม่ถูกต้อง"
            });
        }

        const [jobs] = await db.query(
            "SELECT j.id FROM jobs j JOIN employers e ON j.employer_id = e.id WHERE j.id = ? AND e.user_id = ?",
            [jobId, req.user.id]
        );

        if (jobs.length === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบประกาศงานหรือคุณไม่มีสิทธิ์ดูข้อมูล"
            });
        }

        const [applicants] = await db.query(
            "SELECT a.id AS id, a.id AS application_id, a.job_id, a.user_id, a.message, a.status, a.applied_at, u.id AS student_id, u.full_name, u.email FROM applications a JOIN users u ON a.user_id = u.id WHERE a.job_id = ? ORDER BY a.applied_at DESC",
            [jobId]
        );

        return res.json({
            success: true,
            total: applicants.length,
            data: applicants
        });

    } catch (error) {
        console.error("Load applicants error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดรายชื่อผู้สมัครได้"
        });
    }
});

// =====================================
// EMPLOYER: ดูโปรไฟล์นักศึกษาที่สมัครงาน
// GET /api/applications/:id/profile
// =====================================
router.get("/:id/profile", verifyToken, verifyRole("employer"), async (req, res) => {
    try {
        const applicationId = Number(req.params.id);

        if (!Number.isInteger(applicationId) || applicationId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสใบสมัครไม่ถูกต้อง"
            });
        }

        const [profiles] = await db.query(
            `SELECT
                u.id AS student_id,
                u.full_name,
                u.email,
                sp.phone,
                sp.university,
                sp.faculty,
                sp.major,
                sp.year_level,
                sp.skills,
                sp.experience,
                sp.profile_image
             FROM applications a
             JOIN jobs j ON a.job_id = j.id
             JOIN employers e ON j.employer_id = e.id
             JOIN users u ON a.user_id = u.id
             LEFT JOIN student_profiles sp ON sp.user_id = u.id
             WHERE a.id = ?
               AND e.user_id = ?
             LIMIT 1`,
            [applicationId, req.user.id]
        );

        if (profiles.length === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบโปรไฟล์หรือคุณไม่มีสิทธิ์ดูข้อมูลนี้"
            });
        }

        return res.json({
            success: true,
            data: profiles[0]
        });

    } catch (error) {
        console.error("Load student profile error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดโปรไฟล์นักศึกษาได้"
        });
    }
});

// =====================================
// EMPLOYER: ตอบรับ / ปฏิเสธผู้สมัคร
// PATCH /api/applications/:id/status
// พร้อมระบบ Notification
// =====================================
router.patch("/:id/status", verifyToken, verifyRole("employer"), async (req, res) => {
    let connection;

    try {
        const applicationId = Number(req.params.id);
        const status = req.body.status;

        if (!Number.isInteger(applicationId) || applicationId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสใบสมัครไม่ถูกต้อง"
            });
        }

        if (!["accepted", "rejected", "pending", "completed"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "สถานะผู้สมัครไม่ถูกต้อง"
            });
        }

        connection = await db.getConnection();
        await connection.beginTransaction();

        // ตรวจสอบสิทธิ์นายจ้างและข้อมูลใบสมัคร
        const [applications] = await connection.query(
            "SELECT a.id, a.user_id, a.status AS old_status, j.title, e.company_name FROM applications a JOIN jobs j ON a.job_id = j.id JOIN employers e ON j.employer_id = e.id WHERE a.id = ? AND e.user_id = ? FOR UPDATE",
            [applicationId, req.user.id]
        );

        if (applications.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "ไม่พบใบสมัครหรือคุณไม่มีสิทธิ์แก้ไข"
            });
        }

        const application = applications[0];

        if (status === "completed" && application.old_status !== "accepted") {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "ต้องตอบรับนักศึกษาก่อน จึงจะยืนยันว่าทำงานเสร็จได้"
            });
        }

        // อัปเดตสถานะใบสมัคร
        await connection.query(
            "UPDATE applications SET status = ? WHERE id = ?",
            [status, applicationId]
        );

        // สร้างการแจ้งเตือนเมื่อสถานะเปลี่ยนเป็น accepted หรือ rejected
        if (
            application.old_status !== status &&
            ["accepted", "rejected"].includes(status)
        ) {
            const title = "ผลการสมัครงานอัปเดต";

            const message = status === "accepted"
                ? "ยินดีด้วย! ใบสมัครตำแหน่ง " +
                  application.title +
                  " ได้รับการตอบรับจาก " +
                  application.company_name
                : "ใบสมัครตำแหน่ง " +
                  application.title +
                  " จาก " +
                  application.company_name +
                  " ไม่ได้รับการคัดเลือก";

            await connection.query(
                "INSERT INTO notifications (user_id, application_id, title, message, type) VALUES (?, ?, ?, ?, ?)",
                [
                    application.user_id,
                    applicationId,
                    title,
                    message,
                    status
                ]
            );
        }

        await connection.commit();

        return res.json({
            success: true,
            message: status === "accepted"
                ? "ตอบรับผู้สมัครสำเร็จ"
                : status === "rejected"
                    ? "ปฏิเสธผู้สมัครสำเร็จ"
                        : status === "completed"
                            ? "ยืนยันการทำงานเสร็จสิ้นแล้ว"
                            : "เปลี่ยนสถานะสำเร็จ",
            applicationId: applicationId,
            status: status
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }

        console.error("Update application status error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถเปลี่ยนสถานะผู้สมัครได้"
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// =====================================
// STUDENT: ให้คะแนนงาน
// POST /api/applications/:jobId/rating
// =====================================
router.post("/:jobId/rating", verifyToken, verifyRole("student"), async (req, res) => {
    try {
        const jobId = Number(req.params.jobId);
        const userId = req.user.id;
        const rating = Number(req.body.rating);

        const comment = typeof req.body.comment === "string"
            ? req.body.comment.trim()
            : typeof req.body.review === "string"
                ? req.body.review.trim()
                : "";

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสงานไม่ถูกต้อง"
            });
        }

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                message: "กรุณาเลือกคะแนนตั้งแต่ 1–5 ดาว"
            });
        }

        // ตรวจสอบใบสมัครและสถานะงาน
        const [applications] = await db.query(
            `SELECT
                a.id AS application_id,
                j.id AS job_id,
                e.user_id AS employer_id
             FROM applications a
             JOIN jobs j ON a.job_id = j.id
             JOIN employers e ON j.employer_id = e.id
             WHERE a.job_id = ?
               AND a.user_id = ?
               AND a.status = 'completed'`,
            [jobId, userId]
        );

        if (applications.length === 0) {
            return res.status(403).json({
                success: false,
                message: "คุณสามารถให้คะแนนได้หลังจากทำงานเสร็จแล้วเท่านั้น"
            });
        }

        const application = applications[0];

        // บันทึกคะแนนลงฐานข้อมูล
        await db.query(
            `INSERT INTO job_reviews
                (application_id, student_id, employer_id, job_id, rating, comment)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                application.application_id,
                userId,
                application.employer_id,
                jobId,
                rating,
                comment || null
            ]
        );

        return res.status(201).json({
            success: true,
            message: "ขอบคุณสำหรับการให้คะแนน"
        });

    } catch (error) {
        console.error("Submit job rating error:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "คุณให้คะแนนงานนี้ไปแล้ว"
            });
        }

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถบันทึกคะแนนได้"
        });
    }
});

// =====================================
// PUBLIC: ดูคะแนนและรีวิวของงาน
// GET /api/applications/:jobId/ratings
// =====================================
router.get("/:jobId/ratings", async (req, res) => {
    try {
        const jobId = Number(req.params.jobId);

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสงานไม่ถูกต้อง"
            });
        }

        const [summary] = await db.query(
            `SELECT
                ROUND(AVG(rating), 1) AS average_rating,
                COUNT(*) AS total_reviews
             FROM job_reviews
             WHERE job_id = ?`,
            [jobId]
        );

        const [reviews] = await db.query(
            `SELECT
                r.rating,
                r.comment,
                r.created_at,
                u.full_name
             FROM job_reviews r
             JOIN users u ON r.student_id = u.id
             WHERE r.job_id = ?
             ORDER BY r.created_at DESC`,
            [jobId]
        );

        return res.json({
            success: true,
            average_rating: Number(summary[0].average_rating || 0),
            total_reviews: Number(summary[0].total_reviews || 0),
            data: reviews
        });

    } catch (error) {
        console.error("Load job ratings error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดคะแนนรีวิวได้"
        });
    }
});

// =====================================
// EXPORT ROUTER
// =====================================
module.exports = router;