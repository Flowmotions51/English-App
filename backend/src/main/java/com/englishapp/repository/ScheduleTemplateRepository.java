package com.englishapp.repository;

import com.englishapp.model.ScheduleTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ScheduleTemplateRepository extends JpaRepository<ScheduleTemplate, Long> {
    Optional<ScheduleTemplate> findBySentenceId(Long sentenceId);

    @Query("select distinct st from ScheduleTemplate st left join fetch st.steps where st.sentence.sentenceList.user.id = :userId")
    List<ScheduleTemplate> findBySentenceSentenceListUserId(@Param("userId") Long userId);
}
