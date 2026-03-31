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
    EPISODE_COUNT,
    DURATION,
    AI_CONFIG_ID,
  } = process.env;

  if (!PROJECT_NAME) {
    console.error("Missing PROJECT_NAME");
    process.exit(1);
  }
  if (!NOVEL_IDEA) {
    console.error("Missing NOVEL_IDEA");
    process.exit(1);
  }

  console.log("Using NOVEL_IDEA as content...");
  const novelContent = NOVEL_IDEA;

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
    console.log(`Importing novel content...`);
    await u.db("t_novel").insert({
      projectId,
      chapterIndex: 1,
      reel: "正文",
      chapter: "创意概述",
      chapterData: novelContent,
      createTime: Date.now(),
    });
    console.log("Novel imported.");

    // 3. Run One-Click Generation
    console.log("Starting one-click generation...");
    await runOneClickGeneration({
      projectId,
      episodeCount: EPISODE_COUNT ? parseInt(EPISODE_COUNT, 10) : undefined,
      duration: DURATION ? parseInt(DURATION, 10) : undefined,
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
