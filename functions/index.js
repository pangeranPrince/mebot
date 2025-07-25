const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// --- Endpoint untuk Login ---
exports.login = functions.https.onRequest((request, response) => {
  cors(request, response, async () => {
    try {
      const { email, password, machineId } = request.body;
      if (!email || !password || !machineId) {
        return response.status(400).send({ error: "Data login tidak lengkap." });
      }
      const usersRef = db.collection("users");
      const snapshot = await usersRef.where("email", "==", email).limit(1).get();
      if (snapshot.empty) {
        return response.status(403).send({ error: "Email tidak terdaftar." });
      }
      const userData = snapshot.docs[0].data();
      const userId = snapshot.docs[0].id;
      if (userData.password !== password) {
        return response.status(403).send({ error: "Password salah." });
      }
      if (userData.status !== "approved") {
        return response.status(403).send({ error: "Akun Anda belum disetujui." });
      }
      if (!userData.subscriptionEnd) {
        return response.status(403).send({ error: "Langganan belum diatur oleh admin." });
      }
      const subscriptionEndDate = userData.subscriptionEnd.toDate();
      if (new Date() > subscriptionEndDate) {
        return response.status(403).send({ error: "Langganan Anda telah habis." });
      }
      if (userData.lastMachineId && userData.lastMachineId !== machineId) {
        return response.status(403).send({ error: "Akun ini sudah digunakan di perangkat lain." });
      }
      if (!userData.lastMachineId) {
        await db.collection("users").doc(userId).update({
          lastMachineId: machineId,
          lastLogin: new Date(),
        });
      }
      response.status(200).send({
        message: "Login berhasil!",
        userId: userId,
      });
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      response.status(500).send({ error: "Terjadi error di server." });
    }
  });
});

// --- Endpoint untuk Pendaftaran ---
exports.register = functions.https.onRequest((request, response) => {
  cors(request, response, async () => {
    try {
        const { email, password, duration } = request.body;
        if (!email || !password || !duration) {
          return response.status(400).send({ error: "Data pendaftaran tidak lengkap." });
        }
        const usersRef = db.collection("users");
        const snapshot = await usersRef.where("email", "==", email).limit(1).get();
        if (!snapshot.empty) {
          return response.status(400).send({ error: "Email ini sudah terdaftar." });
        }
        const prices = { "1": 200000, "3": 500000, "12": 750000 };
        const basePrice = prices[duration] || 200000;
        const uniqueCode = Math.floor(Math.random() * 900) + 100;
        const totalAmount = basePrice + uniqueCode;
        const newUser = {
          email: email,
          password: password,
          status: "pending",
          chosenDuration: parseInt(duration, 10),
          uniqueAmount: totalAmount,
          createdAt: new Date(),
          subscriptionEnd: null,
          lastMachineId: null,
        };
        await db.collection("users").add(newUser);
        response.status(200).send({
          message: "Pendaftaran awal berhasil!",
          paymentDetails: {
            amount: totalAmount,
            bank: "SMBC Indonesia",
            accountNumber: "9034-0490-745",
            accountName: "Dede Effi Jurtika",
            csNumber: "0812-3456-7890",
          },
        });
    } catch (err) {
        console.error("REGISTER ERROR:", err);
        response.status(500).send({ error: "Gagal melakukan pendaftaran." });
    }
  });
});
