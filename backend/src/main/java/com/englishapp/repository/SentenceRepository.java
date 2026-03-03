package com.englishapp.repository;

import com.englishapp.model.Sentence;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SentenceRepository extends JpaRepository<Sentence, Long> {
    @Query("select s from Sentence s where s.sentenceList.id = :listId and s.sentenceList.user.id = :userId order by s.createdAt desc")
    List<Sentence> findByListAndUser(@Param("listId") Long listId, @Param("userId") Long userId);

    @Query("select s from Sentence s where s.sentenceList.id = :listId and s.sentenceList.user.id = :userId order by s.createdAt desc")
    Page<Sentence> findByListAndUser(@Param("listId") Long listId, @Param("userId") Long userId, Pageable pageable);

    @Query("select s from Sentence s where s.id = :sentenceId and s.sentenceList.user.id = :userId")
    Optional<Sentence> findByIdAndUser(@Param("sentenceId") Long sentenceId, @Param("userId") Long userId);

    @Query("select s from Sentence s where s.sentenceList.user.id = :userId")
    List<Sentence> findAllByUserId(@Param("userId") Long userId);
}
