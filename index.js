require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
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

async function run() {
  await client.connect();
  const db = client.db("studiospace");
  const studiosCollection = db.collection("studios");
  console.log("MongoDB connected");

  // GET all studios (search, category filter, sort, limit)
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

  // GET single studio by id
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

  // POST add new studio
  app.post("/api/studios", async (req, res) => {
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
        ownerEmail,
        ownerName,
      } = req.body;

      if (
        !title ||
        !category ||
        !hourlyRate ||
        !maxCapacity ||
        !location ||
        !image ||
        !overview ||
        !ownerEmail
      ) {
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
        ownerEmail,
        ownerName: ownerName || "",
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

  // PUT update studio
  app.put("/api/studios/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid studio id" });
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

      const updatedDoc = {
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
      };

      const result = await studiosCollection.updateOne({ _id: new ObjectId(id) }, updatedDoc);
      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "Studio not found" });
      }
      res.send({ message: "Studio updated successfully" });
    } catch (error) {
      res.status(500).send({ message: "Failed to update studio" });
    }
  });

  // DELETE studio
  app.delete("/api/studios/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid studio id" });
      }
      const result = await studiosCollection.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return res.status(404).send({ message: "Studio not found" });
      }
      res.send({ message: "Studio deleted successfully" });
    } catch (error) {
      res.status(500).send({ message: "Failed to delete studio" });
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