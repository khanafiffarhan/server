require("dotenv").config();
const express = require("express"), cors = require("cors"), jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || "*" }), express.json());
const client = new MongoClient(process.env.MONGODB_URI);
let books, borrows;
const verify = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || "").split(" ")[1], process.env.JWT_SECRET); next(); }
  catch { res.status(401).send({ message: "Unauthorized" }); }
};
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

app.get("/", (_, r) => r.send("BookNook API running"));
app.get("/books", async (req, res) => {
  const limit = parseInt(req.query.limit) || 0;
  res.send(await books.find().sort({ createdAt: -1 }).limit(limit).toArray());
});
app.get("/books/:id", async (req, res) => {
  const _id = oid(req.params.id);
  const b = _id && (await books.findOne({ _id }));
  b ? res.send(b) : res.status(404).send({ message: "Book not found" });
});
app.post("/books", verify, async (req, res) => {
  const { title, author, category, image, description, copies, ownerName } = req.body;
  if (!title || !author || !category || !image || !description) return res.status(400).send({ message: "Missing fields" });
  const doc = {
    title, author, category, image, description, copies: Math.max(0, Number(copies) || 1),
    ownerName, ownerEmail: req.user.email, createdAt: new Date()
  };
  res.send(await books.insertOne(doc));
});
app.patch("/books/:id", verify, async (req, res) => {
  const { title, author, category, image, description, copies } = req.body;
  const set = { title, author, category, image, description };
  if (copies !== undefined) set.copies = Math.max(0, Number(copies));
  Object.keys(set).forEach((k) => set[k] === undefined && delete set[k]);
  const r = await books.updateOne({ _id: oid(req.params.id), ownerEmail: req.user.email }, { $set: set });
  r.matchedCount ? res.send(r) : res.status(403).send({ message: "Not allowed" });
});
app.delete("/books/:id", verify, async (req, res) => {
  const r = await books.deleteOne({ _id: oid(req.params.id), ownerEmail: req.user.email });
  r.deletedCount ? res.send(r) : res.status(403).send({ message: "Not allowed" });
});
app.post("/borrows", verify, async (req, res) => {
  const bookId = req.body.bookId, _id = oid(bookId);
  if (!_id) return res.status(400).send({ message: "Invalid book" });
  if (await borrows.findOne({ bookId, userEmail: req.user.email }))
    return res.status(409).send({ message: "You already borrowed this book" });
  const upd = await books.findOneAndUpdate({ _id, copies: { $gt: 0 } }, { $inc: { copies: -1 } }, { returnDocument: "after" });
  if (!upd) return res.status(409).send({ message: "Not Available" });
  const borrowDate = new Date(), returnDate = new Date(Date.now() + 7 * 864e5);
  res.send(await borrows.insertOne({
    bookId, bookTitle: upd.title, bookImage: upd.image,
    userEmail: req.user.email, borrowDate, returnDate
  }));
});
app.get("/borrows", verify, async (req, res) =>
  res.send(await borrows.find({ userEmail: req.user.email }).sort({ borrowDate: -1 }).toArray()));
app.delete("/borrows/:id", verify, async (req, res) => {
  const b = await borrows.findOneAndDelete({ _id: oid(req.params.id), userEmail: req.user.email });
  if (!b) return res.status(404).send({ message: "Borrow not found" });
  await books.updateOne({ _id: oid(b.bookId) }, { $inc: { copies: 1 } });
  res.send({ success: true });
});
client.connect().then(() => {
  const db = client.db("booknook"); books = db.collection("books"); borrows = db.collection("borrows");
  app.listen(process.env.PORT || 5000, () => console.log("Server up"));
});
