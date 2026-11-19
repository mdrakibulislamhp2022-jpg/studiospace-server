require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Challenge 1: verify JWT stored in HTTPOnly cookie
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

async function run() {
  await client.connect();
  const db = client.db("studiospace");
  const studiosCollection = db.collection("studios");
  const bookingsCollection = db.collection("bookings");
  console.log("MongoDB connected");

  // Find a Confirmed booking that overlaps with the requested time slot
  async function findOverlap(studioId, date, startTime, endTime, excludeId) {
    const query = {
      studioId,
      date,
      status: "Confirmed",
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    };
    if (excludeId) {
      query._id = { $ne: new ObjectId(excludeId) };
    }
    return bookingsCollection.findOne(query);
  }

  // ---------- STUDIOS ----------

  // GET all studios (public: search, category filter, sort, limit)
  app.get("/api/studios", async (req, res) => {
    try {
      const { category, search, sort, limit } = req.query;
      const query = {};

      if (category && category !== "all") {
        query.category = category;
      }
      if (search) {
        const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.title = { $regex: safeSearch, $options: "i" };
      }

      let sortOption = { createdAt: -1 };
      if (sort === "rating") sortOption = { rating: -1 };
      if (sort === "price-low") sortOption = { hourlyRate: 1 };
      if (sort === "price-high") sortOption = { hourlyRate: -1 };

      let cursor = studiosCollection.find(query).sort(sortOption);
      if (limit) cursor = cursor.limit(parseInt(limit));

      const studios = await cursor.toArray();
      res.send(studios);
    } catch (error) {
      res.status(500).send({ message: "Failed to load studios" });
    }
  });

  // GET studios owned by the logged-in user (My Listings)
  app.get("/api/my-studios", verifyToken, async (req, res) => {
    try {
      const studios = await studiosCollection
        .find({ ownerEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(studios);
    } catch (error) {
      res.status(500).send({ message: "Failed to load your studios" });
    }
  });

  // GET single studio by id (public)
  app.get("/api/studios/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
      if (!studio) {
        return res.status(404).send({ message: "Studio not found" });
      }
      res.send(studio);
    } catch (error) {
      res.status(500).send({ message: "Failed to load studio" });
    }
  });

  // POST add new studio (protected)
  app.post("/api/studios", verifyToken, async (req, res) => {
    try {
      const {
        title,
        category,
        hourlyRate,
        securityDeposit,
        maxCapacity,
        location,
        image,
        amenities,
        overview,
      } = req.body;

      if (!title || !category || !hourlyRate || !maxCapacity || !location || !image || !overview) {
        return res.status(400).send({ message: "Please fill in all required fields" });
      }

      const newStudio = {
        title,
        category,
        hourlyRate: Number(hourlyRate),
        securityDeposit: Number(securityDeposit) || 0,
        maxCapacity: Number(maxCapacity),
        location,
        image,
        amenities: Array.isArray(amenities) ? amenities : [],
        overview,
        ownerEmail: req.user.email,
        ownerName: req.user.name || "",
        rating: 0,
        reviewCount: 0,
        createdAt: new Date(),
      };

      const result = await studiosCollection.insertOne(newStudio);
      res.status(201).send({ message: "Studio added successfully", insertedId: result.insertedId });
    } catch (error) {
      res.status(500).send({ message: "Failed to add studio" });
    }
  });

  // PUT update studio (protected, owner only)
  app.put("/api/studios/:id", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }

      const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
      if (!studio) {
        return res.status(404).send({ message: "Studio not found" });
      }
      if (studio.ownerEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden: you can only edit your own studios" });
      }

      const {
        title,
        category,
        hourlyRate,
        securityDeposit,
        maxCapacity,
        location,
        image,
        amenities,
        overview,
      } = req.body;

      if (!title || !category || !hourlyRate || !maxCapacity || !location || !image || !overview) {
        return res.status(400).send({ message: "Please fill in all required fields" });
      }

      await studiosCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            title,
            category,
            hourlyRate: Number(hourlyRate),
            securityDeposit: Number(securityDeposit) || 0,
            maxCapacity: Number(maxCapacity),
            location,
            image,
            amenities: Array.isArray(amenities) ? amenities : [],
            overview,
            updatedAt: new Date(),
          },
        }
      );
      res.send({ message: "Studio updated successfully" });
    } catch (error) {
      res.status(500).send({ message: "Failed to update studio" });
    }
  });

  // DELETE studio (protected, owner only)
  app.delete("/api/studios/:id", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }

      const studio = await studiosCollection.findOne({ _id: new ObjectId(id) });
      if (!studio) {
        return res.status(404).send({ message: "Studio not found" });
      }
      if (studio.ownerEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden: you can only delete your own studios" });
      }

      await studiosCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: "Studio deleted successfully" });
    } catch (error) {
      res.status(500).send({ message: "Failed to delete studio" });
    }
  });

  // ---------- BOOKINGS ----------

  // POST create booking (protected, status: Pending)
  app.post("/api/bookings", verifyToken, async (req, res) => {
    try {
      const { studioId, date, startTime, endTime } = req.body;

      if (!studioId || !date || !startTime || !endTime) {
        return res.status(400).send({ message: "Please fill in all booking details" });
      }
      if (!ObjectId.isValid(studioId)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      if (!dateRegex.test(date) || !timeRegex.test(startTime) || !timeRegex.test(endTime)) {
        return res.status(400).send({ message: "Invalid date or time format" });
      }
      if (toMinutes(endTime) <= toMinutes(startTime)) {
        return res.status(400).send({ message: "End time must be after start time" });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (date < today) {
        return res.status(400).send({ message: "You cannot book a past date" });
      }

      const studio = await studiosCollection.findOne({ _id: new ObjectId(studioId) });
      if (!studio) {
        return res.status(404).send({ message: "Studio not found" });
      }

      // Challenge 2: double-booking prevention
      const conflict = await findOverlap(studioId, date, startTime, endTime);
      if (conflict) {
        return res.status(409).send({
          message: `This studio is already booked from ${conflict.startTime} to ${conflict.endTime} on ${date}. Please choose another time.`,
        });
      }

      const hours = (toMinutes(endTime) - toMinutes(startTime)) / 60;
      const newBooking = {
        studioId,
        studioTitle: studio.title,
        studioImage: studio.image,
        studioLocation: studio.location,
        hostEmail: studio.ownerEmail,
        userEmail: req.user.email,
        userName: req.user.name || "",
        date,
        startTime,
        endTime,
        hours,
        hourlyRate: studio.hourlyRate,
        totalPrice: hours * studio.hourlyRate,
        status: "Pending",
        createdAt: new Date(),
      };

      const result = await bookingsCollection.insertOne(newBooking);
      res.status(201).send({ message: "Booking request sent successfully", insertedId: result.insertedId });
    } catch (error) {
      res.status(500).send({ message: "Failed to create booking" });
    }
  });

  // GET bookings made by the logged-in user (My Bookings)
  app.get("/api/bookings", verifyToken, async (req, res) => {
    try {
      const bookings = await bookingsCollection
        .find({ userEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(bookings);
    } catch (error) {
      res.status(500).send({ message: "Failed to load bookings" });
    }
  });

  // GET booking requests received by the logged-in host
  app.get("/api/host-bookings", verifyToken, async (req, res) => {
    try {
      const bookings = await bookingsCollection
        .find({ hostEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(bookings);
    } catch (error) {
      res.status(500).send({ message: "Failed to load booking requests" });
    }
  });

  // PATCH confirm booking (protected, host only)
  app.patch("/api/bookings/:id/confirm", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid booking id" });
      }
      const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
      if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
      }
      if (booking.hostEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden: only the host can confirm this booking" });
      }
      if (booking.status !== "Pending") {
        return res.status(400).send({ message: "Only pending bookings can be confirmed" });
      }

      const conflict = await findOverlap(
        booking.studioId,
        booking.date,
        booking.startTime,
        booking.endTime,
        id
      );
      if (conflict) {
        return res.status(409).send({
          message: `Cannot confirm: another booking is already confirmed from ${conflict.startTime} to ${conflict.endTime} on ${booking.date}.`,
        });
      }

      await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "Confirmed", confirmedAt: new Date() } }
      );
      res.send({ message: "Booking confirmed" });
    } catch (error) {
      res.status(500).send({ message: "Failed to confirm booking" });
    }
  });

  // PATCH cancel booking (protected, booking owner only, Pending only)
  app.patch("/api/bookings/:id/cancel", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid booking id" });
      }
      const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
      if (!booking) {
        return res.status(404).send({ message: "Booking not found" });
      }
      if (booking.userEmail !== req.user.email) {
        return res.status(403).send({ message: "Forbidden: you can only cancel your own bookings" });
      }
      if (booking.status !== "Pending") {
        return res.status(400).send({ message: "Only pending bookings can be cancelled" });
      }
      await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "Cancelled", cancelledAt: new Date() } }
      );
      res.send({ message: "Booking cancelled" });
    } catch (error) {
      res.status(500).send({ message: "Failed to cancel booking" });
    }
  });
}
run().catch(console.error);

app.get("/", (req, res) => {
  res.send("StudioSpace server is running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});