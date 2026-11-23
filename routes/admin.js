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

// ตรวจสอบสิทธิ์ Admin
function verifyAdmin(req, res, next) {
    if (req.user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "คุณไม่มีสิทธิ์เข้าถึงส่วนผู้ดูแลระบบ"
        });
    }

    next();
}

// ทุก API ในไฟล์นี้ต้องเป็น Admin เท่านั้น
router.use(verifyToken, verifyAdmin);

// =====================================
// GET /api/admin/stats
// สรุปข้อมูล Dashboard
// =====================================
router.get("/stats", async (req, res) => {
    try {
        const [
            [users],
            [jobs],
            [applications]
        ] = await Promise.all([
            db.query(`
                SELECT
                    COUNT(*) AS total,
                    SUM(role = 'student') AS students,
                    SUM(role = 'employer') AS employers,
                    SUM(role = 'admin') AS admins
                FROM users
            `),

            db.query(`
                SELECT
                    COUNT(*) AS total,
                    SUM(status = 'open') AS open_jobs,
                    SUM(status = 'pending') AS pending_jobs,
                    SUM(status = 'closed') AS closed_jobs,
                    SUM(status = 'rejected') AS rejected_jobs
                FROM jobs
            `),

            db.query(`
                SELECT
                    COUNT(*) AS total,
                    SUM(status = 'pending') AS pending,
                    SUM(status = 'accepted') AS accepted,
                    SUM(status = 'rejected') AS rejected
                FROM applications
            `)
        ]);

        res.json({
            success: true,
            data: {
                users: users[0],
                jobs: jobs[0],
                applications: applications[0]
            }
        });

    } catch (error) {
        console.error("Admin stats error:", error);

        res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดสถิติได้"
        });
    }
});

// =====================================
// GET /api/admin/users
// รายชื่อสมาชิก
// =====================================
router.get("/users", async (req, res) => {
    try {
        const [users] = await db.query(`
            SELECT id, full_name, email, role, created_at
            FROM users
            ORDER BY created_at DESC
            LIMIT 100
        `);

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        console.error("Admin users error:", error);

        res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดรายชื่อสมาชิกได้"
        });
    }
});

// =====================================
// GET /api/admin/jobs
// รายการประกาศงาน
// =====================================
router.get("/jobs", async (req, res) => {
    try {
        const [jobs] = await db.query(`
            SELECT
                jobs.id,
                jobs.title,
                jobs.category,
                jobs.location,
                jobs.status,
                jobs.created_at,
                employers.company_name
            FROM jobs
            LEFT JOIN employers
                ON jobs.employer_id = employers.id
            ORDER BY jobs.created_at DESC
            LIMIT 100
        `);

        res.json({
            success: true,
            data: jobs
        });

    } catch (error) {
        console.error("Admin jobs error:", error);

        res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดรายการงานได้"
        });
    }
});

// =====================================
// GET /api/admin/applications
// รายการใบสมัคร
// =====================================
router.get("/applications", async (req, res) => {
    try {
        const [applications] = await db.query(`
            SELECT
                applications.id,
                applications.status,
                applications.applied_at,
                users.full_name,
                jobs.title
            FROM applications
            LEFT JOIN users
                ON applications.user_id = users.id
            LEFT JOIN jobs
                ON applications.job_id = jobs.id
            ORDER BY applications.applied_at DESC
            LIMIT 100
        `);

        res.json({
            success: true,
            data: applications
        });

    } catch (error) {
        console.error("Admin applications error:", error);

        res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดรายการใบสมัครได้"
        });
    }
});

// =====================================
// PATCH /api/admin/jobs/:id/status
// Admin เปลี่ยนสถานะประกาศงาน
// =====================================
router.patch("/jobs/:id/status", async (req, res) => {
    try {
        const jobId = Number(req.params.id);
        const { status } = req.body;

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสประกาศงานไม่ถูกต้อง"
            });
        }

        const allowedStatuses = ["open", "rejected", "closed"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "สถานะงานไม่ถูกต้อง"
            });
        }

        const [result] = await db.query(
            "UPDATE jobs SET status = ? WHERE id = ?",
            [status, jobId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบประกาศงานนี้"
            });
        }

        res.json({
            success: true,
            message: "เปลี่ยนสถานะประกาศงานสำเร็จ"
        });

    } catch (error) {
        console.error("Admin update job status error:", error);

        res.status(500).json({
            success: false,
            message: "ไม่สามารถเปลี่ยนสถานะงานได้"
        });
    }
});

// =====================================
// DELETE /api/admin/jobs/:id
// Admin ลบประกาศงาน
// =====================================
router.delete("/jobs/:id", async (req, res) => {
    try {
        const jobId = Number(req.params.id);

        if (!Number.isInteger(jobId) || jobId <= 0) {
            return res.status(400).json({
                success: false,
                message: "รหัสประกาศงานไม่ถูกต้อง"
            });
        }

        const [result] = await db.query(
            "DELETE FROM jobs WHERE id = ?",
            [jobId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "ไม่พบประกาศงานนี้"
            });
        }

        res.json({
            success: true,
            message: "ลบประกาศงานสำเร็จ"
        });

    } catch (error) {
        console.error("Admin delete job error:", error);

        if (error.code === "ER_ROW_IS_REFERENCED_2") {
            return res.status(409).json({
                success: false,
                message: "ไม่สามารถลบงานนี้ได้ เนื่องจากมีใบสมัครงานอยู่ กรุณาปิดประกาศงานแทน"
            });
        }

        res.status(500).json({
            success: false,
            message: "ไม่สามารถลบประกาศงานได้"
        });
    }
});

// =====================================
// GET /api/admin/analytics
// ข้อมูลเชิงลึกสำหรับกราฟ Dashboard
// =====================================
router.get("/analytics", async (req, res) => {
    try {
        const [
            [userRoles],
            [jobStatuses],
            [applicationStatuses],
            [monthlyJobs],
            [monthlyApplications],
            [topJobs]
        ] = await Promise.all([

            // สัดส่วนประเภทผู้ใช้งาน
            db.query(`
                SELECT role, COUNT(*) AS total
                FROM users
                GROUP BY role
            `),

            // จำนวนงานแยกตามสถานะ
            db.query(`
                SELECT status, COUNT(*) AS total
                FROM jobs
                GROUP BY status
            `),

            // สถานะใบสมัคร
            db.query(`
                SELECT status, COUNT(*) AS total
                FROM applications
                GROUP BY status
            `),

            // จำนวนงานที่ประกาศในแต่ละเดือน (6 เดือนล่าสุด)
            db.query(`
                SELECT
                    DATE_FORMAT(created_at, '%Y-%m') AS month,
                    COUNT(*) AS total
                FROM jobs
                WHERE created_at >= DATE_SUB(
                    CURDATE(), INTERVAL 5 MONTH
                )
                GROUP BY DATE_FORMAT(created_at, '%Y-%m')
                ORDER BY month ASC
            `),

            // จำนวนใบสมัครในแต่ละเดือน (6 เดือนล่าสุด)
            db.query(`
                SELECT
                    DATE_FORMAT(applied_at, '%Y-%m') AS month,
                    COUNT(*) AS total
                FROM applications
                WHERE applied_at >= DATE_SUB(
                    CURDATE(), INTERVAL 5 MONTH
                )
                GROUP BY DATE_FORMAT(applied_at, '%Y-%m')
                ORDER BY month ASC
            `),

            // 5 งานที่มีผู้สมัครมากที่สุด
            db.query(`
                SELECT
                    jobs.id,
                    jobs.title,
                    COUNT(applications.id) AS applicants
                FROM jobs
                LEFT JOIN applications
                    ON jobs.id = applications.job_id
                GROUP BY jobs.id, jobs.title
                ORDER BY applicants DESC
                LIMIT 5
            `)
        ]);

        const openJobs = Number(
            jobStatuses.find(x => x.status === "open")?.total || 0
        );

        const rejectedJobs = Number(
            jobStatuses.find(x => x.status === "rejected")?.total || 0
        );

        const closedJobs = Number(
            jobStatuses.find(x => x.status === "closed")?.total || 0
        );

        const decidedJobs = openJobs + rejectedJobs + closedJobs;

        res.json({
            success: true,
            data: {
                userRoles,
                jobStatuses,
                applicationStatuses,
                monthlyJobs,
                monthlyApplications,
                topJobs,
                approvalRate: decidedJobs > 0
                    ? Number((openJobs / decidedJobs * 100).toFixed(1))
                    : 0
            }
        });

    } catch (error) {
        console.error("Admin analytics error:", error);

        res.status(500).json({
            success: false,
            message: "ไม่สามารถโหลดข้อมูลวิเคราะห์ได้"
        });
    }
});

module.exports = router;
