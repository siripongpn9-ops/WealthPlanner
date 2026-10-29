# Wealth Vitality Dashboard

## เปิด Cloud Sync (ให้บ้าน / คลินิก / มือถือ ใช้ข้อมูลชุดเดียวกัน)

ทำครั้งเดียว:

1. **สร้าง Supabase project ใหม่** ที่ supabase.com (แยกจาก project ของบริษัท) เลือก region Singapore
2. **สร้างตาราง:** SQL Editor → New query → วางเนื้อหาไฟล์ `supabase/schema.sql` → Run
3. **คัดลอก key:** Project Settings → API → คัดลอก `Project URL` และ `anon public` key
   (ห้ามใช้ `service_role` key ในหน้าเว็บเด็ดขาด)
4. **ใส่ใน Netlify:** Site configuration → Environment variables → เพิ่ม 2 ตัว
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
5. **Deploy ใหม่:** Deploys → Trigger deploy → **Clear cache and deploy site**
   (ค่า `VITE_` ถูกฝังตอน build ต้อง build ใหม่ทุกครั้งที่แก้ค่า)
6. **สร้างบัญชี:** เปิดเว็บ → สร้างบัญชี → ยืนยันอีเมล → เข้าสู่ระบบ → เลือก "นำเข้าจากไฟล์สำรอง (.json)"
7. **ปิดการสมัครบัญชีใหม่:** Supabase → Authentication → Sign In / Providers → ปิด "Allow new users to sign up"
8. เครื่องอื่น: เปิดเว็บ → เข้าสู่ระบบด้วยบัญชีเดียวกัน → เลือก "ใช้ข้อมูลบน cloud"

รันในเครื่อง: สร้างไฟล์ `.env.local` ใส่สองค่าข้างบน (ไฟล์นี้ไม่ถูกอัปขึ้น GitHub)
ถ้าไม่ใส่ค่า แอปจะทำงานแบบเดิม (เก็บเฉพาะเครื่องนี้) และมีป้ายบอกที่มุมซ้ายล่าง

## รันทดสอบในเครื่องตัวเอง (ก่อน deploy)

ต้องมี [Node.js](https://nodejs.org) ติดตั้งไว้ก่อน (เวอร์ชัน 18 ขึ้นไป)

```bash
npm install
npm run dev
```

เปิด http://localhost:5173 ดูว่าทำงานถูกต้องก่อน

## Deploy ขึ้นเน็ตจริง (แนะนำ Vercel — ฟรี)

1. สร้างบัญชี GitHub (github.com) ถ้ายังไม่มี
2. สร้าง repository ใหม่ (private ก็ได้ ปลอดภัยกว่า)
3. อัปโหลดโฟลเดอร์นี้ทั้งหมดขึ้น repository นั้น (ลาก-วางในหน้าเว็บ GitHub ได้เลย ไม่ต้องรู้ git ก็ได้)
4. ไปที่ [vercel.com](https://vercel.com) → สมัครด้วยบัญชี GitHub
5. กด "Add New Project" → เลือก repository ที่เพิ่งอัปโหลด
6. Vercel จะ detect ว่าเป็น Vite project อัตโนมัติ ไม่ต้องตั้งค่าอะไรเพิ่ม → กด "Deploy"
7. รอ 1-2 นาที จะได้ลิงก์เว็บ (เช่น your-project.vercel.app) ใช้งานได้ทันที

## อัปเดตเว็บทุกครั้งที่แก้โค้ดกับ Claude

1. ดาวน์โหลดไฟล์ `.jsx` เวอร์ชันใหม่จาก Claude
2. แทนที่ไฟล์ `src/App.jsx` ในโฟลเดอร์นี้ด้วยไฟล์ใหม่ (เปลี่ยนชื่อไฟล์เป็น App.jsx)
3. อัปโหลดทับขึ้น GitHub repository เดิม
4. Vercel จะ deploy เวอร์ชันใหม่ให้อัตโนมัติภายในไม่กี่นาที

## ย้ายข้อมูลจาก Claude มาเว็บจริง

ข้อมูลเก็บแยกกันคนละที่ (localStorage ผูกกับโดเมน) ต้องย้ายมือครั้งเดียว:

1. ในหน้า Claude artifact กดปุ่ม "สำรองข้อมูล" (มุมขวาบน) → ได้ไฟล์ `.json`
2. เปิดเว็บที่ deploy แล้ว กดปุ่ม "กู้คืนข้อมูล" → เลือกไฟล์ `.json` ที่เพิ่ง export มา
3. เสร็จแล้ว ข้อมูลทั้งหมดจะย้ายมาอยู่บนเว็บจริง
