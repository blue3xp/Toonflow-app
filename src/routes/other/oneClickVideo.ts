import express from "express";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { runOneClickGeneration } from "@/services/oneClickService";

const router = express.Router();

// 一键生成短视频
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    chapterRange: z.array(z.number()).optional(),
    episodeCount: z.number().optional().default(1),
    duration: z.number().optional().default(120), // 默认120秒
    aiConfigId: z.number().optional(), // 视频生成使用的模型配置ID
  }),
  async (req, res) => {
    const { projectId, chapterRange, episodeCount, duration, aiConfigId } = req.body;

    // 立即响应
    res.status(200).send(success({ message: "一键生成任务已启动，请稍后查看结果" }));

    // 异步执行
    runOneClickGeneration({
      projectId,
      chapterRange,
      episodeCount,
      duration,
      aiConfigId,
    });
  },
);
