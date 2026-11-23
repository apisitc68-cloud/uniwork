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

// =====================================
// ตรวจสอบว่าเป็นผู้ประกอบการ
// =====================================
function verifyEmployer(req, res, next) {
    if (req.user.role !== "employer") {
        return res.status(403).json({
            success: false,
            message: "เฉพาะผู้ประกอบการเท่านั้น"
        });
    }

    next();
}

// =====================================
// ค้นหา Employer ID จาก User ID
// =====================================
async function getEmployerId(userId) {
    const [employers] = await db.query(
        "SELECT id FROM employers WHERE user_id = ? LIMIT 1",
        [userId]
    );

    return employers.length > 0 ? employers[0].id : null;
}

// =====================================
// READ: ดูประกาศงานทั้งหมดที่เปิดรับสมัคร
// GET /api/jobs
// =====================================
router.get("/", async (req, res) => {
    try {
        const sql = `
            SELECT
                jobs.*,
                employers.company_name
            FROM jobs
            JOIN employers
                ON jobs.employer_id = employers.id
            WHERE jobs.status = 'open'
            ORDER BY jobs.created_at DESC
        `;

        const [jobs] = await db.query(sql);

        return res.json({
            success: true,
            total: jobs.length,
            data: jobs
        });

    } catch (error) {
        console.error("Load jobs Error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดรายการงานได้"
        });
    }
});

// =====================================
// READ: ผู้ประกอบการดูประกาศงานของตัวเอง
// GET /api/jobs/my
// =====================================
router.get("/my", verifyToken, verifyEmployer, async (req, res) => {
    try {
        const employerId = await getEmployerId(req.user.id);

        if (!employerId) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบข้อมูลผู้ประกอบการ"
            });
        }

        const [jobs] = await db.query(
            `SELECT * FROM jobs
             WHERE employer_id = ?
             ORDER BY created_at DESC`,
            [employerId]
        );

        return res.json({
            success: true,
            total: jobs.length,
            data: jobs
        });

    } catch (error) {
        console.error("Load my jobs Error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดประกาศงานของคุณได้"
        });
    }
});

// =====================================
// CREATE: เพิ่มประกาศงาน
// POST /api/jobs
// =====================================
router.post("/", verifyToken, verifyEmployer, async (req, res) => {
    try {
        const {
            title,
            description,
            category,
            location,
            salary_min,
            salary_max,
            pay_type,
            work_schedule
        } = req.body;

        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({
                success: false,
                message: "กรุณากรอกชื่อตำแหน่งงาน"
            });
        }

        const minSalary = salary_min === "" || salary_min == null
            ? null : Number(salary_min);

        const maxSalary = salary_max === "" || salary_max == null
            ? null : Number(salary_max);

        if (
            (minSalary !== null && (!Number.isFinite(minSalary) || minSalary < 0)) ||
            (maxSalary !== null && (!Number.isFinite(maxSalary) || maxSalary < 0))
        ) {
            return res.status(400).json({
                success: false,
                message: "กรุณากรอกค่าจ้างให้ถูกต้อง"
            });
        }

        if (
            minSalary !== null &&
            maxSalary !== null &&
            minSalary > maxSalary
        ) {
            return res.status(400).json({
                success: false,
                message: "ค่าจ้างขั้นต่ำต้องไม่มากกว่าค่าสูงสุด"
            });
        }

        const allowedPayTypes = ["hourly", "daily", "monthly"];
        const selectedPayType = pay_type || "hourly";

        if (!allowedPayTypes.includes(selectedPayType)) {
            return res.status(400).json({
                success: false,
                message: "ประเภทการจ่ายเงินไม่ถูกต้อง"
            });
        }

        const employerId = await getEmployerId(req.user.id);

        if (!employerId) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบข้อมูลผู้ประกอบการ"
            });
        }

        const sql = `
            INSERT INTO jobs (
                employer_id,
                title,
                description,
                category,
                location,
                salary_min,
                salary_max,
                pay_type,
                work_schedule,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
        `;

        const [result] = await db.query(sql, [
            employerId,
            title.trim(),
            description || null,
            category || null,
            location || null,
            minSalary,
            maxSalary,
            selectedPayType,
            work_schedule || null
        ]);

        return res.status(201).json({
            success: true,
            message: "เพิ่มประกาศงานสำเร็จ",
            jobId: result.insertId
        });

    } catch (error) {
        console.error("Add job Error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถเพิ่มประกาศงานได้"
        });
    }
});

// =====================================
// UPDATE: แก้ไขประกาศงานของตัวเอง
// PUT /api/jobs/:id
// =====================================
router.put("/:id", verifyToken, verifyEmployer, async (req, res) => {
    try {
        const jobId = Number(req.params.id);

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสประกาศงานไม่ถูกต้อง"
            });
        }

        const employerId = await getEmployerId(req.user.id);

        if (!employerId) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบข้อมูลผู้ประกอบการ"
            });
        }

                const allowedFields = [
            "title",
            "description",
            "category",
            "location",
            "salary_min",
            "salary_max",
            "pay_type",
            "work_schedule",
            "status"
        ];

        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updates.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: "ไม่มีข้อมูลที่ต้องการแก้ไข"
            });
        }

        if (req.body.title !== undefined &&
            (typeof req.body.title !== "string" || !req.body.title.trim())) {
            return res.status(400).json({
                success: false,
                message: "กรุณากรอกชื่อตำแหน่งงาน"
            });
        }

        if (req.body.title !== undefined) {
            values[allowedFields.indexOf("title")];
            const titleIndex = allowedFields
                .filter(field => Object.prototype.hasOwnProperty.call(req.body, field))
                .indexOf("title");

            if (titleIndex >= 0) {
                values[titleIndex] = req.body.title.trim();
            }
        }

        const [existingJobs] = await db.query(
            "SELECT * FROM jobs WHERE id = ? AND employer_id = ?",
            [jobId, employerId]
        );

        if (existingJobs.length === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบประกาศงานหรือคุณไม่มีสิทธิ์แก้ไข"
            });
        }

        const currentJob = existingJobs[0];

        const minSalary = req.body.salary_min !== undefined
            ? (req.body.salary_min === "" || req.body.salary_min === null
                ? null : Number(req.body.salary_min))
            : currentJob.salary_min;

        const maxSalary = req.body.salary_max !== undefined
            ? (req.body.salary_max === "" || req.body.salary_max === null
                ? null : Number(req.body.salary_max))
            : currentJob.salary_max;

        if (
            (minSalary !== null && (!Number.isFinite(Number(minSalary)) || Number(minSalary) < 0)) ||
            (maxSalary !== null && (!Number.isFinite(Number(maxSalary)) || Number(maxSalary) < 0)) ||
            (minSalary !== null && maxSalary !== null && Number(minSalary) > Number(maxSalary))
        ) {
            return res.status(400).json({
                success: false,
                message: "กรุณาตรวจสอบช่วงค่าจ้างให้ถูกต้อง"
            });
        }

        if (req.body.pay_type !== undefined &&
            !["hourly", "daily", "monthly"].includes(req.body.pay_type)) {
            return res.status(400).json({
                success: false,
                message: "ประเภทการจ่ายเงินไม่ถูกต้อง"
            });
        }

        if (req.body.status !== undefined &&
            !["open", "closed"].includes(req.body.status)) {
            return res.status(400).json({
                success: false,
                message: "สถานะประกาศงานไม่ถูกต้อง"
            });
        }

        const [result] = await db.query(
            `UPDATE jobs SET ${updates.join(", ")}
             WHERE id = ? AND employer_id = ?`,
            [...values, jobId, employerId]
        );

        return res.json({
            success: true,
            message: "แก้ไขประกาศงานสำเร็จ"
        });

    } catch (error) {
        console.error("Update job Error:", error);

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถแก้ไขประกาศงานได้"
        });
    }
});


// =====================================
// DELETE: ลบประกาศงานของตัวเอง
// DELETE /api/jobs/:id
// =====================================
router.delete("/:id", verifyToken, verifyEmployer, async (req, res) => {
    try {
        const jobId = Number(req.params.id);

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสประกาศงานไม่ถูกต้อง"
            });
        }

        const employerId = await getEmployerId(req.user.id);

        if (!employerId) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบข้อมูลผู้ประกอบการ"
            });
        }

        const [result] = await db.query(
            "DELETE FROM jobs WHERE id = ? AND employer_id = ?",
            [jobId, employerId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบประกาศงานหรือคุณไม่มีสิทธิ์ลบ"
            });
        }

        return res.json({
            success: true,
            message: "ลบประกาศงานสำเร็จ"
        });

    } catch (error) {
        console.error("Delete job Error:", error);

        if (error.code === "ER_ROW_IS_REFERENCED_2") {
            return res.status(409).json({
                success: false,
                message: "ไม่สามารถลบประกาศงานนี้ได้ เนื่องจากมีผู้สมัครงานแล้ว"
            });
        }

        return res.status(500).json({
            success: false,
            message: "ไม่สามารถลบประกาศงานได้"
        });
    }
});


// =====================================
// EXPORT ROUTER
// =====================================
module.exports = router;
