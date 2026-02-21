import u from "@/utils";
import { runOneClickGeneration } from "@/services/oneClickService";
import fs from "fs";
import path from "path";

async function main() {
  const {
    PROJECT_NAME,
    NOVEL_TYPE,
    ART_STYLE,
    VIDEO_RATIO,
    NOVEL_IDEA,
    NOVEL_FILE_PATH,
    EPISODE_COUNT,
    DURATION,
    AI_CONFIG_ID,
  } = process.env;

  if (!PROJECT_NAME) {
    console.error("Missing PROJECT_NAME");
    process.exit(1);
  }
  if (!NOVEL_FILE_PATH) {
    console.error("Missing NOVEL_FILE_PATH");
    process.exit(1);
  }

  const novelPath = path.resolve(process.cwd(), NOVEL_FILE_PATH);
  if (!fs.existsSync(novelPath)) {
    console.error(`Novel file not found at ${novelPath}`);
    process.exit(1);
  }

  try {
    // 1. Create Project
    console.log(`Creating project: ${PROJECT_NAME}...`);
    const projectData = {
      name: PROJECT_NAME,
      type: NOVEL_TYPE || "未分类",
      artStyle: ART_STYLE || "CG",
      videoRatio: VIDEO_RATIO || "16:9",
      intro: NOVEL_IDEA || "",
      userId: 1, // Default user
      createTime: Date.now(),
    };

    const [projectId] = await u.db("t_project").insert(projectData);
    console.log(`Project created with ID: ${projectId}`);

    // 2. Import Novel
    console.log(`Importing novel from ${novelPath}...`);
    const novelContent = fs.readFileSync(novelPath, "utf-8");
    await u.db("t_novel").insert({
      projectId,
      chapterIndex: 1,
      reel: "正文",
      chapter: "全文",
      chapterData: novelContent,
      createTime: Date.now(),
    });
    console.log("Novel imported.");

    // 3. Run One-Click Generation
    console.log("Starting one-click generation...");
    await runOneClickGeneration({
      projectId,
      episodeCount: EPISODE_COUNT ? parseInt(EPISODE_COUNT, 10) : 1,
      duration: DURATION ? parseInt(DURATION, 10) : 30,
      aiConfigId: AI_CONFIG_ID ? parseInt(AI_CONFIG_ID, 10) : undefined,
    });

    console.log("One-click generation completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Error during execution:", error);
    process.exit(1);
  }
}

main();
