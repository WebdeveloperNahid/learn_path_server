import express, { NextFunction, Request, Response } from "express";
import { Collection, MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
console.log("Starting server...");

const app = express();
const port = process.env.PORT || 5000;

// Middleware — CORS আগে
app.use(cors());
app.use(express.json());

// MongoDB connection (business data — courses, enrollments)
const uri = process.env.MONGO_DB_URI as string;
const client = new MongoClient(uri);

let courseCollection!: Collection;
let enrollmentCollection!: Collection;
let userCollection!: Collection;
let sessionCollection!: Collection;

let isConnected = false;
let connectionPromise: Promise<void> | null = null;

async function connectToMongoDB() {
  if (isConnected) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await client.connect();
      const database = client.db("learnpath");
      courseCollection = database.collection("courses");
      enrollmentCollection = database.collection("enrollments");
      userCollection = database.collection("user");
      sessionCollection = database.collection("session");
      isConnected = true;
      console.log("You successfully connected to MongoDB!");
    } catch (err) {
      console.dir(err);
      connectionPromise = null;
      throw err;
    }
  })();

  return connectionPromise;
}

// প্রতিটা রিকোয়েস্টের আগে DB কানেকশন নিশ্চিত করা হচ্ছে
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await connectToMongoDB();
    next();
  } catch (err) {
    res.status(500).send({ error: "Database connection failed" });
  }
});

// Routes
app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});
//-------------------------------
// ---- Auth Middleware  ----
declare global {
  namespace Express {
    interface Request {
      user?: Record<string, unknown>;
    }
  }
}

const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  console.log("headers", req.headers);
  const authHeader = req.headers?.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(404).send({ message: "unauthorized access" });
  }
  const query = { token: token };
  const session = await sessionCollection.findOne(query);

  if (!session) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  const userId = session.userId;
  const userQuery = { _id: userId };
  const user = await userCollection.findOne(userQuery);
  console.log(userId, "usr id of the session ", user);

  if (!user) {
    return res.status(401).send({ message: "unauthorized access" });
  }

  req.user = user;
  next();
};

const verifyUser = async (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "user") {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

const verifyAdmin = async (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== "admin") {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};
// ---- Auth Middleware শেষ ----

// Routes
app.get("/", (req: Request, res: Response) => {
  res.send("Hello World!");
});
//----------------------------------

//----------------------------------
//Post __Add-Course

app.post(
  "/api/add-course",

  async (req: Request, res: Response) => {
    const cours = req.body;
    const result = await courseCollection.insertOne(cours);
    res.send(result);
  },
);

//----------------------------------
// GET - সব কোর্স (search, filter, sort, pagination সহ)
app.get("/api/add-course", async (req: Request, res: Response) => {
  const { search, category, level, minPrice, maxPrice, sort } =
    req.query as Record<string, string>;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 8;

  const query: Record<string, unknown> = {};

  if (search)
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
    ];

  if (category && category !== "All") query.category = category;
  if (level && level !== "All") query.level = level;

  if (minPrice || maxPrice)
    query.price = {
      ...(minPrice && { $gte: +minPrice }),
      ...(maxPrice && { $lte: +maxPrice }),
    };

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    price_asc: { price: 1 },
    price_desc: { price: -1 },
    rating: { rating: -1 },
  };
  const sortOption = sortMap[sort] || { _id: -1 };

  const total = await courseCollection.countDocuments(query);

  const courses = await courseCollection
    .find(query)
    .sort(sortOption)
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  res.send({ courses, total, page, totalPages: Math.ceil(total / limit) });
});

//----------------------------------
// GET - সর্বশেষ ৬টা কোর্স (Home page "Featured Courses" section এর জন্য)
app.get("/api/add-course/latest", async (req: Request, res: Response) => {
  const courses = await courseCollection
    .find()
    .sort({ _id: -1 })
    .limit(6)
    .toArray();

  res.send(courses);
});

//----------------------------------
// GET - শুধু নির্দিষ্ট instructor এর কোর্স (Manage Courses পেজের জন্য)
// এই route /:id এর আগেই থাকতে হবে
app.get("/api/add-course/user/:userId", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const courses = await courseCollection
    .find({ createdBy: userId })
    .sort({ _id: -1 })
    .toArray();
  res.send(courses);
});

//----------------------------------
// ⚠️ সবার শেষে রাখতে হবে — Get single course by ID
app.get("/api/add-course/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid course ID" });
  }

  const course = await courseCollection.findOne({ _id: new ObjectId(id) });

  if (!course) {
    return res.status(404).send({ error: "Course not found" });
  }

  res.send(course);
});


//---------------------
// PATCH - Update course (শুধু owner পারবে)
app.patch("/api/add-course/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { userId, ...updateData } = req.body;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid course ID" });
  }

  const course = await courseCollection.findOne({ _id: new ObjectId(id) });

  if (!course) {
    return res.status(404).send({ error: "Course not found" });
  }

  if (course.createdBy !== userId) {
    return res.status(403).send({ error: "You can only edit your own course" });
  }

  const result = await courseCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData },
  );

  res.send(result);
});

// DELETE - Delete course (শুধু owner পারবে)
app.delete("/api/add-course/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = req.query.userId as string;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid course ID" });
  }

  const course = await courseCollection.findOne({ _id: new ObjectId(id) });

  if (!course) {
    return res.status(404).send({ error: "Course not found" });
  }

  if (course.createdBy !== userId) {
    return res
      .status(403)
      .send({ error: "You can only delete your own course" });
  }

  const result = await courseCollection.deleteOne({ _id: new ObjectId(id) });

  res.send(result);
});


//-----------------------------------
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}

export default app;
