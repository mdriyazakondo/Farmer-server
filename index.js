const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const serviceAccount = require("./krishilink-farmer-key.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyToken = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization) {
      return res.status(401).send({ message: "Unauthorized: No token found" });
    }
    const token = authorization.split(" ")[1];
    if (!token) {
      return res.status(401).send({ message: "Unauthorized: Invalid token" });
    }
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    res
      .status(401)
      .send({ message: "Unauthorized access", error: error.message });
  }
};

const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASS}@cluster0.8mz1ydx.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("krishiLink-farmer");
    const userCollection = db.collection("users");
    const productCollection = db.collection("products");

    console.log("✅ Successfully connected to MongoDB!");

    //================= user api ====================//
    app.get("/users", async (req, res) => {
      try {
        const currentEmail = req.query.currentEmail;
        const limit = parseInt(req.query.limit) || 50;

        const query = currentEmail ? { email: { $ne: currentEmail } } : {};

        const users = await userCollection
          .find(query, { projection: { password: 0 } })
          .limit(limit)
          .toArray();

        res.status(200).send(users);
      } catch (error) {
        console.error("Get users error:", error);
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
      } catch (error) {
        console.error("Get user error:", error);
        res.status(500).send({ message: "Failed to fetch user" });
      }
    });

    app.post("/users", async (req, res) => {
      try {
        const userData = req.body;

        if (!userData?.email) {
          return res.status(400).send({
            success: false,
            message: "Email is required",
          });
        }
        const existingUser = await userCollection.findOne({
          email: userData.email,
        });
        if (existingUser) {
          await userCollection.updateOne(
            { email: userData.email },
            {
              $set: {
                lastLoginAt: new Date(),
              },
            }
          );
          return res.status(200).send({
            success: true,
            message: "User already exists, login date updated",
          });
        }
        const newUser = {
          ...userData,
          role: "user",
          createdAt: new Date(),
        };
        const result = await userCollection.insertOne(newUser);
        res.status(201).send({
          success: true,
          message: "User created successfully",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("User create error:", error);
        res.status(500).send({
          success: false,
          message: "Failed to create user",
        });
      }
    });

    app.patch("/users/:id/role", async (req, res) => {
      try {
        const id = req.params.id;
        const { role } = req.body;
        if (!role || !["admin", "user"].includes(role)) {
          return res
            .status(400)
            .send({ success: false, message: "Invalid role" });
        }
        const query = { _id: new ObjectId(id) };
        const update = { $set: { role } };
        const result = await userCollection.updateOne(query, update);

        if (result.modifiedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "User not found or role already set",
          });
        }

        res.send({ success: true, message: `Role updated to ${role}` });
      } catch (error) {
        console.error("Role update error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to update role" });
      }
    });

    app.delete("/users/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!id) {
          return res
            .status(400)
            .send({ success: false, message: "User ID is required" });
        }
        const query = { _id: new ObjectId(id) };
        const result = await userCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .send({ success: false, message: "User not found" });
        }
        res.status(200).send({
          success: true,
          message: "User deleted successfully",
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error("Delete user error:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to delete user" });
      }
    });

    // ================ PRODUCTS ================//
    app.get("/products", async (req, res) => {
      const sort = req.query.sort;
      let unitOrder = [];
      if (sort === "bag") unitOrder = ["bag", "kg", "ton"];
      else if (sort === "kg") unitOrder = ["kg", "bag", "ton"];
      else if (sort === "ton") unitOrder = ["ton", "kg", "bag"];
      try {
        const result = await productCollection
          .aggregate([
            {
              $addFields: {
                unitOrderIndex: {
                  $indexOfArray: [unitOrder, "$unit"],
                },
              },
            },
            {
              $sort: {
                unitOrderIndex: 1,
              },
            },
          ])
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch products" });
      }
    });

    app.get("/products/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await productCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch product" });
      }
    });

    app.post("/products", verifyToken, async (req, res) => {
      try {
        const newProduct = req.body;
        const productWithTime = {
          ...newProduct,
          created_at: new Date(),
        };
        const result = await productCollection.insertOne(productWithTime);
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: "Failed to add product" });
      }
    });

    app.put("/products/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const newUpdateData = req.body;

        const query = {
          _id: new ObjectId(id),
          "owner.ownerEmail": req.user.email,
        };

        const result = await productCollection.updateOne(query, {
          $set: newUpdateData,
        });

        if (result.matchedCount === 0) {
          return res
            .status(403)
            .send({ message: "Not authorized or crop not found" });
        }

        res.send(result);
      } catch {
        res.status(500).send({ message: "Failed to update crop" });
      }
    });

    app.get("/latest-products", async (req, res) => {
      try {
        const result = await productCollection
          .find()
          .sort({ created_at: -1 })
          .limit(8)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch latest products" });
      }
    });

    app.delete("/products/:id", verifyToken, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await productCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to delete product" });
      }
    });

    //===========================//

    app.get("/all-products", async (req, res) => {
      const result = await productCollection.find().toArray();
      res.send(result);
    });

    app.get("/my-posted", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;
        const result = await productCollection
          .find({ "owner.ownerEmail": email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch posted crops" });
      }
    });

    app.get("/search", async (req, res) => {
      try {
        const search = req.query.search || "";
        const query = search ? { name: { $regex: search, $options: "i" } } : {};
        const result = await productCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to search crops" });
      }
    });

    app.post("/products/:id/interests", verifyToken, async (req, res) => {
      try {
        const cropId = req.params.id;
        const {
          userEmail,
          userName,
          quantity,
          message,
          ownerName,
          ownerEmail,
        } = req.body;

        if (!quantity || quantity < 1) {
          return res
            .status(400)
            .send({ message: "Quantity must be at least 1" });
        }

        const crop = await productCollection.findOne({
          _id: new ObjectId(cropId),
        });

        if (!crop) return res.status(404).send({ message: "Crop not found" });
        if (crop.owner.ownerEmail === userEmail) {
          return res
            .status(403)
            .send({ message: "Owner cannot submit interest on own crop" });
        }

        const alreadyInterested = crop.interests?.some(
          (interest) => interest.userEmail === userEmail
        );

        if (alreadyInterested) {
          return res
            .status(400)
            .send({ message: "You already submitted interest for this crop" });
        }

        if (quantity > crop.quantity) {
          return res
            .status(400)
            .send({ message: "Not enough quantity available" });
        }

        const newInterest = {
          _id: new ObjectId(),
          cropId: crop._id.toString(),
          userEmail,
          userName,
          ownerName,
          ownerEmail,
          quantity,
          message,
          status: "pending",
          createdAt: new Date(),
        };

        const result = await productCollection.updateOne(
          { _id: new ObjectId(cropId) },
          {
            $push: { interests: newInterest },
          }
        );

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to submit interest" });
      }
    });

    app.patch(
      "/products/:cropId/interests/:interestId",
      verifyToken,
      async (req, res) => {
        try {
          const { cropId, interestId } = req.params;
          const { status } = req.body;

          const crop = await productCollection.findOne({
            _id: new ObjectId(cropId),
          });
          if (!crop) return res.status(404).send({ message: "Crop not found" });

          const interest = crop.interests.find(
            (i) => i._id.toString() === interestId
          );
          if (!interest)
            return res.status(404).send({ message: "Interest not found" });

          const updateObj = { "interests.$.status": status.toLowerCase() };

          if (status.toLowerCase() === "accepted") {
            await productCollection.updateOne(
              {
                _id: new ObjectId(cropId),
                "interests._id": new ObjectId(interestId),
              },
              {
                $set: updateObj,
                $inc: { quantity: -interest.quantity },
              }
            );
          } else {
            await productCollection.updateOne(
              {
                _id: new ObjectId(cropId),
                "interests._id": new ObjectId(interestId),
              },
              { $set: updateObj }
            );
          }

          res.send({ message: "Interest updated successfully" });
        } catch (err) {
          console.error(err);
          res.status(500).send({ message: "Server error" });
        }
      }
    );

    app.get("/my-interests", verifyToken, async (req, res) => {
      try {
        const userEmail = req.query.userEmail;
        const sortType = req.query.sort;

        const crops = await productCollection
          .find({ "interests.userEmail": userEmail })
          .toArray();

        const interestCrops = crops.map((crop) => {
          const interest = crop.interests.find(
            (i) => i.userEmail === userEmail
          );
          return {
            cropId: crop._id,
            cropName: crop.name,
            interest,
          };
        });

        if (sortType === "low-high") {
          interestCrops.sort(
            (a, b) => a.interest.quantity - b.interest.quantity
          );
        } else if (sortType === "high-low") {
          interestCrops.sort(
            (a, b) => b.interest.quantity - a.interest.quantity
          );
        }

        res.send(interestCrops);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch interests" });
      }
    });
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
  }
}

run().catch(console.dir);

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});
