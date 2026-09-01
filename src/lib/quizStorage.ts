import { supabase } from '@/integrations/supabase/client';
import { Question } from '@/data/quizQuestions';

export interface DatabaseQuiz {
  id: string;
  title: string;
  description: string;
  time_limit: number;
  is_public: boolean;
  teacher_id: string;
  created_at: string;
  updated_at: string;
}

export interface DatabaseQuestion {
  id: string;
  quiz_id: string;
  question_text: string;
  options: string[];
  correct_answer: string;
  question_type: string;
  order_index: number;
  points: number;
}

export interface DatabaseQuizAttempt {
  id: string;
  quiz_id: string;
  student_id: string;
  score: number;
  total_points: number;
  time_taken: number;
  answers: number[];
  completed_at: string;
}

export interface TeacherQuizWithAttempts extends DatabaseQuiz {
  questionCount: number;
  attempts: Array<{ id: string; student_id: string; student_name: string; score: number; total_points: number; completed_at: string; answers: number[] }>;
}
// Store a quiz with its questions in the database
export const createQuizInDB = async (
  quizData: {
    title: string;
    description: string;
    timeLimit: number;
    questions: Question[];
    isActive?: boolean;
  },
  userId: string
): Promise<string | null> => {
  try {
    console.log('Creating quiz with data:', {
      ...quizData,
      questions: quizData.questions.map(q => ({
        ...q,
        options: q.options // Just show the options for debugging
      }))
    });

    // Insert quiz
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .insert({
        title: quizData.title,
        description: quizData.description,
        time_limit: quizData.timeLimit * 60, // Convert minutes to seconds
        is_public: quizData.isActive ?? true,
        teacher_id: userId,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (quizError) {
      console.error('Error creating quiz:', quizError);
      return null;
    }

    if (!quiz) {
      console.error('No quiz data returned after creation');
      return null;
    }

    console.log('Quiz created with ID:', quiz.id);
    console.log('Quiz data:', {
      id: quiz.id,
      title: quizData.title,
      description: quizData.description,
      time_limit: quizData.timeLimit * 60,
      is_public: quizData.isActive ?? true,
      teacher_id: userId
    });

    // Prepare questions for insertion
    console.log('Preparing to insert questions...');
    const questionsToInsert = [];
    
    for (let i = 0; i < quizData.questions.length; i++) {
      const question = quizData.questions[i];
      try {
        console.log('Processing question:', question);
        
        // Ensure options is an array of strings
        const options = Array.isArray(question.options) 
          ? question.options.map(opt => String(opt).trim()).filter(opt => opt.length > 0)
          : [];
        
        console.log('Processed options:', options);
        
        if (options.length === 0) {
          console.warn(`Question ${i + 1} has no valid options, skipping`);
          continue;
        }
        
        // Ensure correct answer is within bounds
        const correct = typeof question.correct === 'number' 
          ? Math.max(0, Math.min(question.correct, options.length - 1)) 
          : 0;

        const questionData = {
          quiz_id: quiz.id,
          question_text: String(question.question || `Question ${i + 1}`).trim(),
          options: JSON.stringify(options), // Convert array to JSON string
          correct_answer: String(correct).trim(),
          order_index: i,
          question_type: 'multiple_choice', // Must match the check constraint in the database
          points: 1,
          created_at: new Date().toISOString()
        };

        console.log('Prepared question data:', questionData);

        // Validate the question data
        if (!questionData.question_text) {
          console.warn(`Question ${i + 1} has no text, skipping`);
          continue;
        }

        if (questionData.options.length < 2) {
          console.warn(`Question ${i + 1} needs at least 2 options, skipping`);
          continue;
        }

        questionsToInsert.push(questionData);
      } catch (error) {
        console.error(`Error processing question ${i + 1}:`, error);
      }
    }
    
    console.log('Questions to be inserted:', JSON.stringify(questionsToInsert, null, 2));

    if (questionsToInsert.length === 0) {
      console.error('No valid questions to insert');
      await supabase.from('quizzes').delete().eq('id', quiz.id);
      return null;
    }

    console.log('Inserting questions...');

    try {
      // Insert questions one by one to identify any problematic ones
      const insertedQuestions = [];
      
      for (const question of questionsToInsert) {
        try {
          console.log('Inserting question:', question.question_text);
          console.log('Question data to insert:', JSON.stringify(question, null, 2));
          
          // Validate required fields
          const requiredFields = ['quiz_id', 'question_text', 'options', 'correct_answer', 'order_index', 'question_type', 'points', 'created_at'];
          const missingFields = requiredFields.filter(field => question[field] === undefined || question[field] === null);
          
          if (missingFields.length > 0) {
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
          }
          
          const { data, error } = await supabase
            .from('questions')
            .insert({
              quiz_id: question.quiz_id,
              question_text: question.question_text,
              options: question.options,
              correct_answer: question.correct_answer,
              order_index: question.order_index,
              question_type: 'multiple_choice', // Ensure it matches the check constraint
              points: question.points,
              created_at: question.created_at
            })
            .select()
            .single();
            
          if (error) {
            console.error('Error inserting question:', {
              question: question.question_text,
              error: {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint
              },
              questionData: question
            });
            throw error;
          }
          
          console.log('Successfully inserted question:', data);
          insertedQuestions.push(data);
        } catch (error) {
          console.error('Failed to insert question. Question data:', JSON.stringify(question, null, 2));
          console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            ...(error.response?.data && { responseData: error.response.data }),
            ...(error.response?.status && { statusCode: error.response.status })
          });
          throw error; // Re-throw to trigger the cleanup
        }
      }
      
      console.log('Successfully inserted questions:', insertedQuestions);
      console.log('Successfully created quiz with questions');
      return quiz.id;
    } catch (error) {
      console.error('Error in questions transaction:', error);
      await supabase.from('quizzes').delete().eq('id', quiz.id);
      return null;
    }
  } catch (error) {
    console.error('Error in createQuizInDB:', error);
    return null;
  }
};

// Get all quizzes created by a teacher
export const getTeacherQuizzes = async (userId: string): Promise<DatabaseQuiz[]> => {
  try {
    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('teacher_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching teacher quizzes:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching teacher quizzes:', error);
    return [];
  }
};

// The dashboard loads attempts by quiz_id after first scoping quizzes to the teacher.
// This avoids local browser state and makes any RLS failure explicit.
export const getTeacherQuizzesWithAttempts = async (userId: string): Promise<TeacherQuizWithAttempts[]> => {
  const quizzes = await getTeacherQuizzes(userId);
  if (quizzes.length === 0) return [];

  const quizIds = quizzes.map((quiz) => quiz.id);
  const [{ data: questionRows, error: questionsError }, { data: attemptRows, error: attemptsError }] = await Promise.all([
    supabase.from('questions').select('quiz_id').in('quiz_id', quizIds),
    supabase.from('quiz_attempts')
      .select('id, quiz_id, student_id, score, total_points, completed_at, answers, student:profiles!quiz_attempts_student_id_fkey(name)')
      .in('quiz_id', quizIds)
      .order('completed_at', { ascending: true }),
  ]);

  if (questionsError) console.error('Error fetching teacher quiz questions:', questionsError);
  if (attemptsError) throw new Error(`Unable to load quiz attempts: ${attemptsError.message}`);

  const questionCounts = new Map<string, number>();
  for (const question of questionRows || []) {
    questionCounts.set(question.quiz_id, (questionCounts.get(question.quiz_id) || 0) + 1);
  }

  const attemptsByQuiz = new Map<string, TeacherQuizWithAttempts['attempts']>();
  for (const attempt of attemptRows || []) {
    const student = attempt.student as { name: string } | null;
    const attempts = attemptsByQuiz.get(attempt.quiz_id) || [];
    attempts.push({
      id: attempt.id,
      student_id: attempt.student_id,
      student_name: student?.name || 'Student',
      score: attempt.score || 0,
      total_points: attempt.total_points || 0,
      completed_at: attempt.completed_at || attempt.id,
      answers: Array.isArray(attempt.answers) ? attempt.answers.filter((answer): answer is number => typeof answer === 'number') : [],
    });
    attemptsByQuiz.set(attempt.quiz_id, attempts);
  }

  return quizzes.map((quiz) => ({
    ...quiz,
    questionCount: questionCounts.get(quiz.id) || 0,
    attempts: attemptsByQuiz.get(quiz.id) || [],
  }));
};
// Get a quiz with its questions
export const getQuizWithQuestions = async (quizId: string) => {
  try {
    // Get quiz details
    const { data: quiz, error: quizError } = await supabase
      .from('quizzes')
      .select('*')
      .eq('id', quizId)
      .single();

    if (quizError) {
      console.error('Error fetching quiz:', quizError);
      return null;
    }

    // Get questions
    const { data: questionsData, error: questionsError } = await supabase
      .from('questions')
      .select('*')
      .eq('quiz_id', quizId)
      .order('order_index');

    if (questionsError) {
      console.error('Error fetching questions:', questionsError);
      return null;
    }

    // Transform the database format to our app's format
    const questions = questionsData.map(q => {
      // Parse options JSON string back to array
      let options = [];
      try {
        options = typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || []);
      } catch (e) {
        console.error('Error parsing question options:', e);
        options = [];
      }

      return {
        id: q.id,
        question: q.question_text,
        options: options,
        correct: parseInt(q.correct_answer, 10) || 0,
        type: q.question_type || 'multiple_choice',
        points: q.points || 1
      };
    });

    // Ensure all required fields are present in the quiz object
    const formattedQuiz = {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description || '',
      time_limit: quiz.time_limit || 300, // Default to 5 minutes if not set
      is_public: quiz.is_public || false,
      teacher_id: quiz.teacher_id,
      created_at: quiz.created_at,
      questions: questions
    };

    console.log('Formatted quiz data:', formattedQuiz);
    return formattedQuiz;
  } catch (error) {
    console.error('Error fetching quiz with questions:', error);
    return null;
  }
};

// Store a quiz attempt
export const storeQuizAttempt = async (
  quizId: string,
  userId: string,
  score: number,
  totalPoints: number,
  timeSpent: number,
  answers: number[],
  startedAt: string
): Promise<DatabaseQuizAttempt> => {
  const completedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('quiz_attempts')
    .insert({ quiz_id: quizId, student_id: userId, score, total_points: totalPoints, time_taken: timeSpent, answers, started_at: startedAt, completed_at: completedAt })
    // Returning the inserted row verifies that the INSERT passed RLS.
    .select('id, quiz_id, student_id, score, total_points, time_taken, answers, started_at, completed_at')
    .single();

  if (error) {
    console.error('Error storing quiz attempt:', { code: error.code, message: error.message, details: error.details, hint: error.hint });
    throw new Error(error.message);
  }
  return data as DatabaseQuizAttempt;
};

// Get user's quiz attempts
export const getUserQuizAttempts = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('quiz_attempts')
      .select(`
        *,
        quiz:quizzes(title)
      `)
      .eq('student_id', userId)
      .order('completed_at', { ascending: false });

    if (error) {
      console.error('Error fetching user quiz attempts:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching user quiz attempts:', error);
    return [];
  }
};

// Store default quiz topics in database (for system-wide quizzes)
export const storeDefaultQuizTopics = async (): Promise<void> => {
  try {
    // We'll store these as system quizzes with a special system user ID
    const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
    
    // First check if default quizzes already exist
    const { data: existingQuizzes } = await supabase
      .from('quizzes')
      .select('id')
      .eq('teacher_id', SYSTEM_USER_ID);

    if (existingQuizzes && existingQuizzes.length > 0) {
      // Default quizzes already exist
      return;
    }

    // Import quiz topics dynamically to avoid circular dependencies
    const { quizTopics } = await import('@/data/quizQuestions');
    
    for (const topic of quizTopics) {
      await createQuizInDB({
        title: topic.title,
        description: topic.description,
        timeLimit: 15, // Default 15 minutes
        questions: topic.questions,
        isActive: true,
      }, SYSTEM_USER_ID);
    }
  } catch (error) {
    console.error('Error storing default quiz topics:', error);
  }
};

// Get system default quizzes
export const getDefaultQuizzes = async (): Promise<DatabaseQuiz[]> => {
  try {
    const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
    
    const { data, error } = await supabase
      .from('quizzes')
      .select('*')
      .eq('teacher_id', SYSTEM_USER_ID)
      .order('title');

    if (error) {
      console.error('Error fetching default quizzes:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    
    console.error('Error fetching default quizzes:', error);
    return [];
  }
};