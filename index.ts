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

let isConnected = false;
let connectionPromise: Promise<void> | null = null;

async function connectToMongoDB() {
  if (isConnected) return;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await client.connect();
      const database = client.db(process.env.AUTH_DB_NAME || "learnpath");
      courseCollection = database.collection("courses");
      enrollmentCollection = database.collection("enrollments");
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


//-----------------------------------
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}

export default app;