import { ConvexClient } from "convex/browser";
const convex = new ConvexClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default convex;
