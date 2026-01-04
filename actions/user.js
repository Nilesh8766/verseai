"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { generateAIInsights } from "./dashboard";

/**
 * Update user profile and ensure industry insights exist
 */
export async function updateUser(data) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
  });

  if (!user) throw new Error("User not found");

  try {
    // 1️⃣ Generate AI insights OUTSIDE transaction (CRITICAL)
    let insights = null;

    const existingIndustry = await db.industryInsight.findUnique({
      where: {
        industry: data.industry,
      },
    });

    if (!existingIndustry) {
      insights = await generateAIInsights(data.industry);
    }

    // 2️⃣ Transaction: DATABASE ONLY
    const result = await db.$transaction(async (tx) => {
      let industryInsight = existingIndustry;

      if (!industryInsight) {
        industryInsight = await tx.industryInsight.create({
          data: {
            industry: data.industry,
            ...insights,
            nextUpdate: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000 // +7 days
            ),
          },
        });
      }

      const updatedUser = await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          industry: data.industry,
          experience: data.experience,
          bio: data.bio,
          skills: data.skills,
        },
      });

      return { updatedUser, industryInsight };
    });

    revalidatePath("/");
    return result.updatedUser;
  } catch (error) {
    console.error("Error updating user and industry:", error);
    throw new Error("Failed to update profile");
  }
}

/**
 * Check if user has completed onboarding
 */
export async function getUserOnboardingStatus() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: {
      clerkUserId: userId,
    },
    select: {
      industry: true,
    },
  });

  return {
    isOnboarded: Boolean(user?.industry),
  };
}
