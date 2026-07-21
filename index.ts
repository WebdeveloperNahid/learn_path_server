import express, { NextFunction, Request, Response } from "express";
import { Collection, MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
console.log("Starting server...");
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
const port = process.env.PORT || 5000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

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
let recommendationFeedbackCollection!: Collection;

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
      recommendationFeedbackCollection = database.collection("recommendationFeedback");
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
  if (req.user?.role !== "instructor") {
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
  verifyToken,
  verifyAdmin,
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
    .limit(8)
    .toArray();

  res.send(courses);
});

//----------------------------------
// GET - শুধু নির্দিষ্ট instructor এর কোর্স (Manage Courses পেজের জন্য)
// এই route /:id এর আগেই থাকতে হবে
app.get(
  "/api/add-course/user/:userId",
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response) => {
    const { userId } = req.params;
    const courses = await courseCollection
      .find({ createdBy: userId })
      .sort({ _id: -1 })
      .toArray();
    res.send(courses);
  },
);

//----------------------------------
// ⚠️ সবার শেষে রাখতে হবে — Get single course by ID
app.get(
  "/api/add-course/:id",
  async (req: Request, res: Response) => {
    const id = req.params.id as string;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid course ID" });
    }

    const course = await courseCollection.findOne({ _id: new ObjectId(id) });

    if (!course) {
      return res.status(404).send({ error: "Course not found" });
    }

    res.send(course);
  },
);

//---------------------
// PATCH - Update course (শুধু owner পারবে)
app.patch(
  "/api/add-course/:id",
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response) => {
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
      return res
        .status(403)
        .send({ error: "You can only edit your own course" });
    }

    const result = await courseCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData },
    );

    res.send(result);
  },
);

// DELETE - Delete course (শুধু owner পারবে)
app.delete(
  "/api/add-course/:id",
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response) => {
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
  },
);

//----------------------------------
// AI - Content Generator (course description generate করার জন্য)
// AI - Content Generator (real regenerate variation সহ)
app.post(
  "/api/ai/generate-description",
  verifyToken,
  verifyAdmin,
  async (req: Request, res: Response) => {
    try {
      const { title, category, level, length, attempt } = req.body;

      if (!title || !category) {
        return res
          .status(400)
          .send({ error: "Title and category are required" });
      }

      const wordTarget =
        length === "short" ? "40-60" : length === "long" ? "150-200" : "80-120";

      const variationHint =
        attempt && attempt > 1
          ? ` This is regeneration attempt #${attempt} — give a genuinely different angle from a typical version: vary the opening line, highlight a different practical benefit or outcome than usual, and change the sentence structure.`
          : "";

      const prompt = `You are an expert course content writer. Write a compelling course description for an online course.

Course Title: ${title}
Category: ${category}
Level: ${level || "Beginner"}

Write ONLY the description text (${wordTarget} words), no headings, no markdown, no quotes. Make it engaging, highlight practical outcomes, and match the tone of a professional online learning platform.${variationHint}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      res.send({ description: text.trim() });
    } catch (err) {
      console.error("AI generate-description error:", err);
      res.status(500).send({ error: "Failed to generate description" });
    }
  },
);

//----------------------------------

// AI - Chat Assistant (platform/course বিষয়ক প্রশ্নের উত্তর দিবে)
// AI - Chat Assistant (platform/course বিষয়ক প্রশ্নের উত্তর দিবে + real AI follow-ups)
app.post("/api/ai/chat", async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body as {
      message: string;
      history?: { role: "user" | "model"; text: string }[];
    };

    if (!message) {
      return res.status(400).send({ error: "Message is required" });
    }

    const courses = await courseCollection
      .find(
        {},
        {
          projection: {
            title: 1,
            category: 1,
            level: 1,
            price: 1,
            instructor: 1,
          },
        },
      )
      .limit(30)
      .toArray();

    const courseContext = courses
      .map(
        (c) =>
          `- ${c.title} (${c.category}, ${c.level}, $${c.price}, by ${c.instructor})`,
      )
      .join("\n");

    const systemContext = `You are the AI assistant for "LearnPath", an online course marketplace platform offering courses in Web Development, Graphic Design, Photography, AI/ML, Python, and more.

Here is a sample of currently available courses:
${courseContext}

Answer the user's question helpfully and concisely. If they ask about courses, recommend from the list above when relevant. If they ask about navigating the site, guide them (e.g. "/all-course" to browse, "/signup" to create an account). Keep responses under 100 words unless more detail is clearly needed.

Do not use any markdown formatting such as **, #, bullet points with *, or numbered lists. Write in plain, natural sentences only.

After answering, also suggest 3 short, relevant follow-up questions the user is likely to ask next, based specifically on this answer and the conversation so far — not generic ones.

Respond ONLY in this exact JSON format, nothing else, no extra text before or after:
{"reply": "your answer text here", "followUps": ["question 1", "question 2", "question 3"]}`;

    const chatHistory =
      history?.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })) || [];

    const chat = model.startChat({
      history: [
        { role: "user", parts: [{ text: systemContext }] },
        {
          role: "model",
          parts: [{ text: "Understood, I'm ready to help LearnPath users." }],
        },
        ...chatHistory,
      ],
    });

    const result = await chat.sendMessage(message);
    const rawText = result.response.text().trim();

    let parsed: { reply: string; followUps: string[] };
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { reply: rawText, followUps: [] };
    }

    res.send({ reply: parsed.reply, followUps: parsed.followUps || [] });
  } catch (err) {
    console.error("AI chat error:", err);
    res.status(500).send({ error: "Failed to get AI response" });
  }
});

// AI - Smart Recommendation Engine
app.get(
  "/api/ai/recommend/:userId",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { category: filterCategory } = req.query as Record<string, string>;

      const enrollments = await enrollmentCollection.find({ userId }).toArray();
      const enrolledCourseIds = enrollments
        .map((e) => e.courseId?.toString())
        .filter(Boolean);

      const enrolledCourses = enrolledCourseIds.length
        ? await courseCollection
            .find({ _id: { $in: enrolledCourseIds.map((id) => new ObjectId(id)) } })
            .project({ title: 1, category: 1, level: 1 })
            .toArray()
        : [];

      const excludeIds = enrolledCourseIds.map((id) => new ObjectId(id));

      const feedback = await recommendationFeedbackCollection
        .find({ userId })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();

      const dismissedIds = feedback
        .filter((f) => f.action === "dismissed")
        .map((f) => f.courseId?.toString());

      let candidateQuery: Record<string, unknown> = {
        _id: { $nin: [...excludeIds, ...dismissedIds.map((id) => new ObjectId(id))] },
      };
      if (filterCategory && filterCategory !== "All") {
        candidateQuery.category = filterCategory;
      }

      const candidateCourses = await courseCollection
        .find(candidateQuery)
        .project({ title: 1, category: 1, level: 1, price: 1, rating: 1 })
        .limit(40)
        .toArray();

      // নতুন ইউজার — কোনো enrollment history নাই
      if (enrolledCourses.length === 0) {
        const popular = await courseCollection
          .find(filterCategory && filterCategory !== "All" ? { category: filterCategory } : {})
          .sort({ rating: -1 })
          .limit(4)
          .toArray();

        return res.send({
          recommendations: popular.map((c) => ({
            courseId: c._id,
            title: c.title,
            reason: "Popular course among learners on the platform.",
          })),
        });
      }

      const enrolledContext = enrolledCourses
        .map((c) => `- ${c.title} (${c.category}, ${c.level})`)
        .join("\n");

      const candidateContext = candidateCourses
        .map((c) => `- id:${c._id} | ${c.title} (${c.category}, ${c.level}, $${c.price})`)
        .join("\n");

      const feedbackContext = feedback.length
        ? feedback
            .map((f) => `- learner ${f.action} a previously suggested course (id ${f.courseId})`)
            .join("\n")
        : "No prior recommendation interaction yet.";

      const prompt = `A learner on an online course platform has enrolled in these courses:
${enrolledContext}

Recent interaction with previous recommendations:
${feedbackContext}

Here are other available courses on the platform:
${candidateContext}

Based on the learner's enrollment pattern (categories, level, skill progression) and their past interaction with recommendations (avoid suggesting things similar to dismissed ones, lean toward categories they clicked into), pick the 4 most relevant courses from the available list.

Respond ONLY in this exact JSON format, nothing else:
{"recommendations": [{"courseId": "the id from the list", "title": "course title", "reason": "one short sentence explaining why this fits this specific learner"}]}`;

      const result = await model.generateContent(prompt);
      const rawText = result.response.text().trim();

      let parsed;
      try {
        const cleaned = rawText.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = { recommendations: [] };
      }

      res.send(parsed);
    } catch (err) {
      console.error("AI recommend error:", err);
      res.status(500).send({ error: "Failed to generate recommendations" });
    }
  },
);

// AI - Recommendation feedback (continuously improve করার জন্য)
app.post(
  "/api/ai/recommend/feedback",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const { userId, courseId, action } = req.body as {
        userId: string;
        courseId: string;
        action: "clicked" | "dismissed";
      };

      if (!userId || !courseId || !action) {
        return res.status(400).send({ error: "Missing required fields" });
      }

      await recommendationFeedbackCollection.insertOne({
        userId,
        courseId,
        action,
        createdAt: new Date(),
      });

      res.send({ success: true });
    } catch (err) {
      console.error("Recommendation feedback error:", err);
      res.status(500).send({ error: "Failed to save feedback" });
    }
  },
);

//----------------------------------
// POST - Enroll in a course (payment ছাড়া, simple version)
app.post(
  "/api/enroll",
  verifyToken,
  async (req: Request, res: Response) => {
    try {
      const { courseId } = req.body;
      const userId = (req.user as any)._id.toString();

      if (!courseId) {
        return res.status(400).send({ error: "courseId is required" });
      }

      // আগে থেকেই enroll করা কিনা চেক
      const existing = await enrollmentCollection.findOne({
        userId,
        courseId,
      });
      if (existing) {
        return res.status(400).send({ error: "Already enrolled" });
      }

      const result = await enrollmentCollection.insertOne({
        userId,
        courseId,
        enrolledAt: new Date(),
      });

      res.send({ success: true, enrollmentId: result.insertedId });
    } catch (err) {
      console.error("Enroll error:", err);
      res.status(500).send({ error: "Failed to enroll" });
    }
  },
);

// GET - user এর enrollment list (My Courses পেজের জন্যও কাজে লাগবে)
app.get(
  "/api/enroll/user/:userId",
  verifyToken,verifyUser,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const enrollments = await enrollmentCollection
        .find({ userId })
        .toArray();
      res.send(enrollments);
    } catch (err) {
      console.error("Get enrollments error:", err);
      res.status(500).send({ error: "Failed to fetch enrollments" });
    }
  },
);

//-----------------------------------
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}

export default app;
