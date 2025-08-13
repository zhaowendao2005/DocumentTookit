"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const readline = require("readline");


async function askDepth() {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const question = (q) => new Promise((resolve) => rl.question(q, resolve));
	try {
		const answer = await question("请输入遍历深度（0=仅当前目录，1=含一级子目录，回车默认0）：");
		rl.close();
		if (!answer || !answer.trim()) return 0;
		const depth = Number(answer.trim());
		if (Number.isInteger(depth) && depth >= 0) return depth;
		console.log("输入无效，使用默认深度 0。");
		return 0;
	} catch (e) {
		rl.close();
		console.log("读取输入失败，使用默认深度 0。");
		return 0;
	}
}

async function collectMarkdownFiles(rootDir, maxDepth) {
	const result = [];
	const stack = [{ dir: rootDir, depth: 0 }];
	while (stack.length > 0) {
		const { dir, depth } = stack.pop();
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch (e) {
			console.error(`无法读取目录：${dir} -> ${e && e.message ? e.message : e}`);
			continue;
		}
		for (const ent of entries) {
			const fullPath = path.join(dir, ent.name);
			if (ent.isFile()) {
				if (ent.name.toLowerCase().endsWith(".md")) {
					result.push(fullPath);
				}
			} else if (ent.isDirectory()) {
				if (depth < maxDepth) {
					stack.push({ dir: fullPath, depth: depth + 1 });
				}
			}
		}
	}
	return result;
}

(async function main() {
	const TARGET_EXT = ".md";
	const rootDir = process.cwd();

	try {
		const maxDepth = await askDepth();
		const mdFiles = await collectMarkdownFiles(rootDir, maxDepth);

		if (mdFiles.length === 0) {
			console.log("未找到任何 .md 文件，已结束。");
			return;
		}

		console.log(`发现 ${mdFiles.length} 个 ${TARGET_EXT} 文件，开始处理...`);

		for (const filePath of mdFiles) {
			const fileName = path.basename(filePath);
			const displayPath = path.relative(rootDir, filePath) || fileName;
			try {
				let content = await fsp.readFile(filePath, "utf8");

				// 检测并保留 BOM（若存在）
				const hasBOM = content.charCodeAt(0) === 0xfeff;
				if (hasBOM) {
					content = content.slice(1);
				}

				// 选择行结束符，尽量与现有文件保持一致
				const eol = content.includes("\r\n") ? "\r\n" : content.includes("\n") ? "\n" : os.EOL;

				// 取第一行进行幂等性判断
				const firstNewlineIndex = content.indexOf("\n");
				const firstLineRaw = firstNewlineIndex === -1 ? content : content.slice(0, firstNewlineIndex);
				const firstLine = firstLineRaw.replace(/\r$/, "").trim();

				if (firstLine === fileName) {
					console.log(`跳过（已存在文件名作为第一行）：${displayPath}`);
					continue;
				}

				const newContent = (hasBOM ? "\ufeff" : "") + `${fileName}${eol}` + content;
				await fsp.writeFile(filePath, newContent, "utf8");
				console.log(`已处理：${displayPath}`);
			} catch (err) {
				console.error(`处理失败：${displayPath} -> ${err && err.message ? err.message : err}`);
			}
		}

		console.log("全部处理完成。");
	} catch (e) {
		console.error(`执行失败：${e && e.message ? e.message : e}`);
		process.exitCode = 1;
	}
})();


