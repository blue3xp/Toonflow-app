import u from "@/utils";
import OutlineScript from "@/agents/outlineScript";
import Storyboard from "@/agents/storyboard";
import { generateScript, Episode } from "@/utils/generateScript";
import { generateVideoAsync } from "@/utils/videoGenerator";
import { t_config } from "@/types/database";
import { v4 as uuidv4 } from "uuid";

interface OneClickParams {
  projectId: number;
  chapterRange?: number[];
  episodeCount?: number;
  duration?: number;
  aiConfigId?: number;
}

// 提取路径名的辅助函数
const getPathname = (url: string): string => {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return new URL(url).pathname;
  }
  return url;
};

export async function runOneClickGeneration({
  projectId,
  chapterRange,
  episodeCount = 1,
  duration = 30,
  aiConfigId,
}: OneClickParams) {
  try {
    console.log(`[一键生成] 开始处理项目 ${projectId}`);

    // 1. 初始化 OutlineScript
    const outlineAgent = new OutlineScript(projectId);
    const novelData = await u.db("t_novel").where({ projectId }).orderBy("chapterIndex", "asc");
    if (novelData.length === 0) {
      console.error(`[一键生成] 项目 ${projectId} 没有小说章节`);
      return;
    }
    outlineAgent.setNovel(novelData);

    // 2. 生成故事线
    let rangeText = "全部章节";
    if (chapterRange && chapterRange.length > 0) {
      rangeText = `第${chapterRange.join("、")}章`;
    }
    console.log(`[一键生成] 生成故事线 (${rangeText})`);
    await outlineAgent.call(`分析${rangeText}生成故事线`);

    // 3. 生成大纲
    console.log(`[一键生成] 生成大纲 (${episodeCount}集, 每集${duration}秒)`);
    await outlineAgent.call(`确认故事线，生成大纲，共${episodeCount}集，每集时长${duration}秒`);

    // 4. 生成资产
    console.log(`[一键生成] 生成资产`);
    await outlineAgent.call("确认大纲，生成资产");

    // 5. 生成剧本
    console.log(`[一键生成] 生成剧本`);
    const outlines = await u.db("t_outline").where({ projectId });
    for (const outline of outlines) {
      try {
        const episode = JSON.parse(outline.data || "{}") as Episode;
        const scriptRec = await u.db("t_script").where({ outlineId: outline.id }).first();

        if (scriptRec && episode.chapterRange) {
          // 获取关联的原文章节内容
          const chapters = await u
            .db("t_novel")
            .whereIn("chapterIndex", episode.chapterRange)
            .where("projectId", projectId)
            .select("chapter", "chapterData");
          const novelText = chapters.map((c) => `${c.chapter}\n${c.chapterData}`).join("\n\n");

          console.log(`[一键生成] 生成第 ${episode.episodeIndex} 集剧本`);
          const scriptContent = await generateScript(episode, novelText);
          await u.db("t_script").where({ id: scriptRec.id }).update({ content: scriptContent });

          // 6. 生成分镜
          console.log(`[一键生成] 生成第 ${episode.episodeIndex} 集分镜`);
          const sbAgent = new Storyboard(projectId, scriptRec.id);
          // 重新加载 novel chapters，虽然 Storyboard 可能不需要，但以防万一
          sbAgent.novelChapters = novelData;

          await sbAgent.call("生成片段");
          await sbAgent.call("为全部片段生成分镜，使用4宫格"); // 默认4宫格
          await sbAgent.call("为全部分镜生成图片");

          // 等待图片生成完成
          console.log(`[一键生成] 等待分镜图片生成...`);
          await sbAgent.waitForAllGenerations(30 * 60 * 1000); // 30分钟超时

          // 7. 保存分镜到数据库
          console.log(`[一键生成] 保存分镜到数据库`);
          const shots = sbAgent.getShotsData();

          for (const shot of shots) {
            // 检查 t_assets 是否存在
            // Storyboard agent uses internal ID counter.
            // We need to insert new assets.
            // Each shot is an asset of type "分镜"

            const maxIdRes: any = await u.db("t_assets").max("id as maxId").first();
            const newAssetId = (maxIdRes?.maxId || 0) + 1;

            // 插入 t_assets
            await u.db("t_assets").insert({
              id: newAssetId,
              projectId,
              scriptId: scriptRec.id,
              type: "分镜",
              name: shot.title,
              intro: shot.fragmentContent, // 片段描述
              segmentId: shot.segmentId + 1, // segmentIndex
              shotIndex: shot.id,
              state: "done",
            });

            // 插入 t_image
            for (const cell of shot.cells) {
              if (cell.src) {
                const imagePath = getPathname(cell.src);
                const maxImgIdRes: any = await u.db("t_image").max("id as maxId").first();
                const newImgId = (maxImgIdRes?.maxId || 0) + 1;

                await u.db("t_image").insert({
                  id: newImgId,
                  assetsId: newAssetId,
                  scriptId: scriptRec.id,
                  projectId,
                  filePath: imagePath,
                  type: "分镜",
                  state: "done",
                });
              }
            }

            // 8. 生成视频
            console.log(`[一键生成] 生成分镜视频`);

            // 获取 AI 配置
            let aiConfig: t_config | undefined;
            if (aiConfigId) {
              aiConfig = await u.db("t_config").where("id", aiConfigId).first();
            }
            if (!aiConfig) {
              // 尝试找一个默认的视频生成模型
              aiConfig = await u.db("t_config").where("type", "video").first();
            }

            if (aiConfig) {
              const filePaths = shot.cells.map((c) => c.src).filter((s): s is string => !!s);

              if (filePaths.length > 0) {
                // 插入 t_videoConfig
                const maxConfigId: any = await u.db("t_videoConfig").max("id as maxId").first();
                const newConfigId = (maxConfigId?.maxId || 0) + 1;
                const now = Date.now();

                await u.db("t_videoConfig").insert({
                  id: newConfigId,
                  scriptId: scriptRec.id,
                  projectId,
                  aiConfigId: aiConfig.id,
                  manufacturer: aiConfig.manufacturer,
                  mode: "multi", // 4-grid is likely multi
                  images: JSON.stringify(shot.cells.map((c, i) => ({ id: i, filePath: c.src, prompt: c.prompt }))),
                  resolution: "1024x1024", // Default?
                  duration: 5, // Default 5s per shot?
                  prompt: shot.cells.map((c) => c.prompt).join("\n"),
                  createTime: now,
                  updateTime: now,
                  audioEnabled: 0,
                });

                // Create t_video and trigger generation
                const maxVideoId: any = await u.db("t_video").max("id as maxId").first();
                const newVideoId = (maxVideoId?.maxId || 0) + 1;
                const savePath = `/${projectId}/video/${uuidv4()}.mp4`; // Or extract from utils if I exposed uuidv4 there? I imported uuidv4 here.

                // Extract paths for t_video
                const storyboardImgs = filePaths.map((url) => getPathname(url));

                await u.db("t_video").insert({
                  id: newVideoId,
                  scriptId: scriptRec.id,
                  configId: newConfigId,
                  time: 5,
                  resolution: "1024x1024",
                  prompt: shot.cells.map((c) => c.prompt).join("\n"),
                  firstFrame: storyboardImgs[0],
                  storyboardImgs: JSON.stringify(storyboardImgs),
                  filePath: savePath,
                  state: 0,
                });

                await generateVideoAsync(
                  newVideoId,
                  projectId,
                  filePaths,
                  savePath,
                  shot.cells.map((c) => c.prompt).join("\n"),
                  5,
                  "1024x1024",
                  false,
                  aiConfig,
                );
              }
            } else {
              console.error("[一键生成] 未找到视频生成配置，跳过视频生成");
            }
          }
        }
      } catch (err) {
        console.error(`[一键生成] 处理大纲 ${outline.id} 失败:`, err);
      }
    }

    console.log(`[一键生成] 项目 ${projectId} 处理完成`);
  } catch (e) {
    console.error(`[一键生成] 任务失败:`, e);
  }
}
