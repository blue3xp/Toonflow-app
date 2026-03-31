import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { generateVideoAsync, sharpProcessingImage } from "@/utils/videoGenerator";

const router = express.Router();

// 生成视频
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    scriptId: z.number(),
    configId: z.number().optional(), // 关联的视频配 置ID
    type: z.string().optional(),
    resolution: z.string(),
    aiConfigId: z.number(),
    filePath: z.array(z.string()),
    duration: z.number(),
    prompt: z.string(),
    mode: z.enum(["startEnd", "multi", "single", "text"]),
    audioEnabled: z.boolean(),
  }),
  async (req, res) => {
    const { type, mode, scriptId, projectId, configId, aiConfigId, resolution, filePath, duration, prompt, audioEnabled } = req.body;

    if (mode == "text") filePath.length = 0;
    else if (!filePath.length) {
      return res.status(500).send(error("请先选择图片"));
    }
    const configData = await u.db("t_videoConfig").where("id", configId).first();

    if (!configData) {
      return res.status(500).send(error("视频配置不存在"));
    }
    if (configData.manufacturer == "runninghub") {
      if (filePath.length > 1) {
        const gridUrl = await sharpProcessingImage(filePath, projectId);
        if (gridUrl) {
          filePath.length = 0;
          filePath.push(gridUrl);
        }
      }
    }

    // 优先使用视频配置中的AI配置ID查询,查不到再使用传入的aiConfigId
    let aiConfigData = null;
    if (configData.aiConfigId) {
      aiConfigData = await u.db("t_config").where("id", configData.aiConfigId).first();
    }
    if (!aiConfigData) {
      aiConfigData = await u.db("t_config").where("id", aiConfigId).first();
    }

    if (!aiConfigData) {
      return res.status(500).send(error("模型配置不存在"));
    }
    // 过滤掉空值
    let fileUrl = filePath.filter((p: string) => p && p.trim() !== "");

    // 处理文件路径，如果是 base64 则上传到 OSS
    if (fileUrl.length) {
      const match = fileUrl[0].match(/base64,([A-Za-z0-9+/=]+)/);
      if (match && match.length >= 2) {
        const imagePath = `/${projectId}/assets/${uuidv4()}.jpg`;
        const buffer = Buffer.from(match[1], "base64");
        await u.oss.writeFile(imagePath, buffer);
        fileUrl = [await u.oss.getFileUrl(imagePath)];
      }
    }

    // 提取路径名的辅助函数
    const getPathname = (url: string): string => {
      // 如果是完整 URL，提取 pathname
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return new URL(url).pathname;
      }
      // 否则认为已经是路径
      return url;
    };
    if (fileUrl.length) {
      // 校验文件是否存在
      const fileExistsResults = await Promise.all(
        fileUrl.map(async (url: string) => {
          const path = getPathname(url);
          return u.oss.fileExists(path);
        }),
      );

      if (!fileExistsResults.every(Boolean)) {
        return res.status(400).send(error("选择分镜文件不存在"));
      }
    }

    const firstFrame = fileUrl.length ? getPathname(fileUrl[0]) : "";
    const storyboardImgs = fileUrl.map((path: string) => getPathname(path));
    const savePath = `/${projectId}/video/${uuidv4()}.mp4`;

    // 先插入记录，state 默认为 0
    const [videoId] = await u.db("t_video").insert({
      scriptId,
      configId: configId || null, // 关联的视频配置ID
      time: duration,
      resolution,
      prompt,
      firstFrame,
      storyboardImgs: JSON.stringify(storyboardImgs),
      filePath: savePath,
      state: 0,
    });

    // 立即返回，不等待视频生成
    res.status(200).send(success({ id: videoId, configId: configId || null }));

    // 异步生成视频
    generateVideoAsync(videoId, projectId, fileUrl, savePath, prompt, duration, resolution, audioEnabled, aiConfigData);
  },
);
